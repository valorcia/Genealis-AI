"""Analyse de documents historiques : OCR / transcription IA, extraction d'entités, comparaison.

Une transcription IA n'est jamais présentée comme certaine : les mots incertains sont marqués
entre crochets [?mot] et chaque extraction porte un niveau de confiance.
"""
from __future__ import annotations

import hashlib
import io
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models import Media
from ..services import settings_service as cfg
from ..services.gendate import parse_gendate
from .providers import AIClient, AIUnavailable

SYSTEM_TRANSCRIBE = (
    "Tu es un paléographe expert des actes d'état civil et des registres paroissiaux européens "
    "(français, latin, italien, polonais, allemand). Transcris fidèlement le document, ligne par ligne, "
    "sans rien inventer. Marque chaque mot illisible ou incertain entre crochets avec un point "
    "d'interrogation, par exemple [?Dupont]. N'ajoute aucun commentaire en dehors de la transcription."
)

SYSTEM_EXTRACT = (
    "Tu es un généalogiste professionnel. À partir de la transcription fournie, extrais les informations "
    "sous forme de JSON strict, sans rien inventer. Si une information est absente, mets null. Schéma :\n"
    '{"language": "fr|it|pl|de|la|en|ru|?", "document_type": "birth|baptism|marriage|death|burial|census|other",'
    ' "date": "texte de la date tel qu\'écrit", "place": "lieu de l\'acte", '
    '"persons": [{"role": "subject|father|mother|spouse|spouse_father|spouse_mother|witness|godfather|godmother|declarant|other",'
    ' "given_names": "...", "surname": "...", "age": null, "occupation": null, "residence": null, "birth_place": null,'
    ' "birth_date": null, "deceased": false, "confidence": "high|medium|low"}],'
    ' "relations": [{"type": "parent|spouse", "from": "index persons", "to": "index persons", "evidence": "citation exacte"}],'
    ' "uncertain_passages": ["..."], "translation_fr": "traduction française si le texte n\'est pas en français, sinon null"}'
)

LANG_HINTS = {
    "fr": ["né", "née", "fils de", "fille de", "décédé", "mariage", "paroisse", "baptême", "l'an"],
    "la": ["baptizatus", "baptizata", "filius", "filia", "anno domini", "sepultus", "matrimonium", "die"],
    "it": ["nato", "nata", "figlio di", "figlia di", "comune", "atto di nascita", "morte", "matrimonio", "anno"],
    "pl": ["urodzony", "urodzona", "syn", "córka", "parafia", "zmarł", "małżeństwo", "roku", "dnia"],
    "de": ["geboren", "sohn", "tochter", "gestorben", "getauft", "heirat", "ehe", "jahres"],
    "en": ["born", "son of", "daughter of", "died", "married", "parish", "baptised", "baptized"],
    "ru": ["родился", "сын", "дочь", "умер", "брак", "года"],
}


def detect_language(text: str) -> str:
    low = (text or "").lower()
    best, best_n = "?", 0
    for lang, words in LANG_HINTS.items():
        n = sum(low.count(w) for w in words)
        if n > best_n:
            best, best_n = lang, n
    return best


def tesseract_available(db: Session | None = None) -> Optional[str]:
    custom = cfg.get(db, "tesseract_cmd") if db is not None else None
    if custom and Path(custom).exists():
        return custom
    found = shutil.which("tesseract")
    if found:
        return found
    for cand in (r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"):
        if Path(cand).exists():
            return cand
    return None


def load_images(path: Path, max_pages: int = 10) -> list[bytes]:
    """Charge un fichier image/PDF en liste d'images PNG (une par page)."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        try:
            import fitz  # PyMuPDF (optionnel en mode hébergé)
        except ImportError as exc:
            raise RuntimeError("Lecture PDF indisponible sur cette installation : importez une image (JPEG/PNG) de l'acte.") from exc

        out = []
        with fitz.open(path) as doc:
            for i, page in enumerate(doc):
                if i >= max_pages:
                    break
                pix = page.get_pixmap(dpi=200)
                out.append(pix.tobytes("png"))
        return out
    from PIL import Image

    with Image.open(path) as im:
        im = im.convert("RGB")
        if max(im.size) > 2400:
            ratio = 2400 / max(im.size)
            im = im.resize((int(im.width * ratio), int(im.height * ratio)))
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        return [buf.getvalue()]


def ocr_tesseract(images: list[bytes], cmd: str, langs: str = "fra+ita+pol+deu+lat+eng") -> tuple[str, list[dict]]:
    import pytesseract
    from PIL import Image

    pytesseract.pytesseract.tesseract_cmd = cmd
    available = set(pytesseract.get_languages(config=""))
    use = "+".join(l for l in langs.split("+") if l in available) or "eng"
    text_parts, words = [], []
    for page_no, img in enumerate(images):
        im = Image.open(io.BytesIO(img))
        text_parts.append(pytesseract.image_to_string(im, lang=use))
        data = pytesseract.image_to_data(im, lang=use, output_type=pytesseract.Output.DICT)
        for i, w in enumerate(data["text"]):
            if w.strip():
                try:
                    conf = float(data["conf"][i])
                except (TypeError, ValueError):
                    conf = -1
                words.append({"page": page_no, "text": w, "conf": conf, "x": data["left"][i], "y": data["top"][i],
                              "w": data["width"][i], "h": data["height"][i]})
    return "\n\n".join(text_parts), words


# ---------- Extraction par règles (sans IA) ----------
_RE_FILS = re.compile(r"\b(fils|fille)\s+(?:légitime\s+)?de\s+([A-ZÉÈ][\w'\-]+(?:\s+[A-ZÉÈ][\w'\-]+){0,3})(?:\s*,[^,]{0,60})?,?\s+et\s+(?:de\s+)?([A-ZÉÈ][\w'\-]+(?:\s+[A-ZÉÈ][\w'\-]+){0,3})", re.U)
_RE_NE_A = re.compile(r"\bn[ée]e?\s+(?:le\s+)?([^,;]+?)\s+à\s+([A-ZÉÈ][\w'\- ]+)", re.U | re.I)
_RE_EPOUX = re.compile(r"\b(?:époux|épouse|veuf|veuve)\s+de\s+([A-ZÉÈ][\w'\-]+(?:\s+[A-ZÉÈ][\w'\-]+){0,3})", re.U)
_RE_AGE = re.compile(r"\bâgée?\s+de\s+(\d{1,3})\s+ans", re.U)
_RE_DATE = re.compile(r"\b(\d{1,2}(?:er)?\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(?:mil\s+[\w\s]+?|\d{4}))\b", re.I | re.U)
_RE_YEAR = re.compile(r"\b(1[5-9]\d{2}|20\d{2})\b")
_RE_PROFESSION = re.compile(r"\b(cultivateur|laboureur|manœuvre|manoeuvre|journalier|mineur|ouvrier|tisserand|vigneron|charpentier|maçon|boulanger|forgeron|tailleur|cordonnier|instituteur|ménagère|domestique|sans profession)\b", re.I)


def rule_based_extract(text: str) -> dict:
    """Extraction minimale par expressions régulières (français). Confiance basse."""
    persons = []
    relations = []
    for m in _RE_FILS.finditer(text):
        persons.append({"role": "father", "given_names": None, "surname": m.group(2), "confidence": "low"})
        persons.append({"role": "mother", "given_names": None, "surname": m.group(3), "confidence": "low"})
    for m in _RE_EPOUX.finditer(text):
        persons.append({"role": "spouse", "given_names": None, "surname": m.group(1), "confidence": "low"})
    dates = _RE_DATE.findall(text)
    years = _RE_YEAR.findall(text)
    occ = _RE_PROFESSION.findall(text)
    ages = _RE_AGE.findall(text)
    place = None
    m = _RE_NE_A.search(text)
    if m:
        place = m.group(2).strip()
    return {"language": detect_language(text), "document_type": _guess_doc_type(text),
            "date": dates[0] if dates else (years[0] if years else None), "place": place,
            "persons": persons, "relations": relations, "years": sorted(set(years)), "occupations": occ,
            "ages": ages, "uncertain_passages": [], "translation_fr": None, "method": "rules"}


def _guess_doc_type(text: str) -> str:
    low = text.lower()
    for key, t in (("acte de naissance", "birth"), ("est né", "birth"), ("baptême", "baptism"), ("baptisé", "baptism"),
                   ("acte de mariage", "marriage"), ("mariage", "marriage"), ("acte de décès", "death"),
                   ("est décédé", "death"), ("inhumé", "burial"), ("recensement", "census"), ("atto di nascita", "birth"),
                   ("atto di morte", "death"), ("atto di matrimonio", "marriage"), ("baptizat", "baptism"),
                   ("sepult", "burial"), ("urodz", "birth"), ("zmar", "death")):
        if key in low:
            return t
    return "other"


@dataclass
class AnalysisResult:
    transcription: str
    method: str
    language: str
    extraction: dict
    words: list[dict] = field(default_factory=list)
    uncertain: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"transcription": self.transcription, "method": self.method, "language": self.language,
                "extraction": self.extraction, "words": self.words[:2000], "uncertain": self.uncertain,
                "warnings": self.warnings}


def analyze_media(db: Session, media: Media, *, engine: str | None = None) -> AnalysisResult:
    from ..services import storage

    path = storage.local_copy(media.path)
    images = load_images(path)
    engine = engine or cfg.get(db, "ocr_engine", "auto")
    ai = AIClient(db)
    warnings: list[str] = []
    transcription, words, method = "", [], "none"

    use_ai = engine in ("auto", "ai") and ai.available()
    tess = tesseract_available(db) if engine in ("auto", "tesseract") else None

    if use_ai:
        try:
            r = ai.complete(SYSTEM_TRANSCRIBE, "Transcris ce document historique. Marque les mots incertains entre [?].",
                            purpose=f"transcription document {media.id}", personal=True, images=images, max_tokens=4000)
            transcription, method = r.text, f"ai:{r.provider}:{r.model}"
        except AIUnavailable as exc:
            warnings.append(f"Transcription IA indisponible : {exc}")
    if not transcription and tess:
        try:
            transcription, words = ocr_tesseract(images, tess)
            method = "tesseract"
            warnings.append("OCR Tesseract : adapté aux imprimés, peu fiable sur l'écriture manuscrite ancienne.")
        except Exception as exc:  # pragma: no cover - dépend de l'installation
            warnings.append(f"Tesseract a échoué : {exc}")
    if not transcription:
        if engine == "none" or (not use_ai and not tess):
            warnings.append("Aucun moteur de transcription disponible (installez Tesseract ou configurez un modèle IA). "
                            "Le document est conservé ; vous pouvez saisir la transcription manuellement.")
        return AnalysisResult("", "none", "?", {"persons": [], "relations": []}, warnings=warnings)

    uncertain = re.findall(r"\[\?([^\]]*)\]", transcription)
    language = detect_language(transcription)
    extraction: dict = {}
    if ai.available():
        try:
            r = ai.complete(SYSTEM_EXTRACT, f"Transcription :\n\n{transcription}", purpose=f"extraction {media.id}",
                            personal=True, json_mode=True, max_tokens=3000)
            extraction = r.json()
            extraction["method"] = f"ai:{r.provider}"
            if isinstance(extraction.get("language"), str) and extraction["language"] != "?":
                language = extraction["language"]
        except (AIUnavailable, ValueError) as exc:
            warnings.append(f"Extraction IA indisponible, repli sur les règles : {exc}")
    if not extraction:
        extraction = rule_based_extract(transcription)
    # Normalisation des dates extraites
    if extraction.get("date"):
        gd = parse_gendate(extraction["date"])
        extraction["date_normalized"] = gd.to_dict()
    for p in extraction.get("persons", []) or []:
        if p.get("birth_date"):
            p["birth_date_normalized"] = parse_gendate(p["birth_date"]).to_dict()
    return AnalysisResult(transcription, method, language, extraction, words, uncertain, warnings)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

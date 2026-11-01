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

# Types de documents proposés à l'utilisateur (« auto » = détection par l'IA)
DOC_KINDS: dict[str, str] = {
    "auto": "Détection automatique",
    "birth": "Acte de naissance / baptême",
    "marriage": "Acte de mariage",
    "death": "Acte de décès / sépulture",
    "census": "Table de recensement",
    "military_register": "Registre matricule militaire",
    "decennial_table": "Table décennale",
    "death_notice": "Faire-part / avis de décès",
    "family_photo": "Photo de famille",
    "other": "Autre document",
}
DOCUMENT_TYPES = ("birth", "baptism", "marriage", "death", "burial", "census", "military_register", "decennial_table",
                  "death_notice", "family_photo", "other")
PERSON_ROLES = ("subject", "father", "mother", "spouse", "spouse_father", "spouse_mother", "witness", "declarant",
                "godfather", "godmother", "deceased", "head_of_household", "household_member", "other")

# Schéma unique (lecture IA en un appel, extraction depuis une transcription, mode copier-coller)
EXTRACTION_SCHEMA = (
    '{"document_type": "birth|baptism|marriage|death|burial|census|military_register|decennial_table|death_notice|family_photo|other", '
    '"language": "fr|la|de|it|pl|en|ru|…", '
    '"date": "date de l\'acte telle qu\'écrite", "date_iso": "AAAA-MM-JJ, AAAA-MM ou AAAA, ou null", '
    '"event_date": "date de l\'événement (naissance, décès…) si différente de celle de l\'acte, telle qu\'écrite, sinon null", '
    '"event_date_iso": "AAAA-MM-JJ ou null", '
    '"place": "commune de l\'acte (département, pays)", "act_number": "numéro de l\'acte ou null", '
    '"officer": "officier d\'état civil, curé ou agent recenseur, tel qu\'écrit, ou null", '
    '"persons": [{"role": "subject|father|mother|spouse|spouse_father|spouse_mother|witness|declarant|godfather|godmother|deceased|head_of_household|household_member|other", '
    '"given_names": "prénoms", "surname": "NOM", "sex": "M|F|null", "age": nombre ou null, '
    '"birth_date": "telle qu\'écrite ou null", "birth_place": null, "occupation": null, "residence": null, '
    '"relation": "lien avec le sujet ou le chef de ménage (ex. « père de l\'époux », « fils », « veuve de »), ou null", '
    '"deceased": false, "confidence": "high|medium|low"}], '
    '"households": [{"address": "rue / lieu-dit / n° de maison", "number": "n° de ménage ou null", '
    '"members": [{"given_names": "...", "surname": "...", "relation_to_head": "chef|épouse|fils|fille|mère|père|frère|sœur|domestique|pensionnaire|…", '
    '"sex": "M|F|null", "age": nombre ou null, "birth_year": nombre ou null, "birth_place": null, "nationality": null, '
    '"occupation": null, "confidence": "high|medium|low"}]}], '
    '"military": {"matricule": null, "class_year": null, "recruitment_office": null, '
    '"physical_description": {"height": null, "hair": null, "eyes": null, "face": null, "marks": null}, '
    '"education_level": null, "campaigns": ["..."], "decorations": ["..."], "remarks": null}, '
    '"entries": [{"event_type": "birth|marriage|death", "date": "telle qu\'écrite", "date_iso": null, "given_names": "...", '
    '"surname": "...", "spouse": null, "note": null}], '
    '"relations": [{"type": "parent|spouse|sibling", "from": 0, "to": 1, "evidence": "citation exacte"}], '
    '"uncertain_passages": ["..."], '
    '"translation_fr": "traduction française complète si le texte n\'est pas en français, sinon null", '
    '"summary_fr": "une phrase simple qui résume le document pour un débutant"}'
)

EXTRACTION_RULES = (
    "Conventions : dans un acte de mariage, role « subject » = l'époux, « spouse » = l'épouse, « father »/« mother » = "
    "parents de l'époux, « spouse_father »/« spouse_mother » = parents de l'épouse. Dans un acte de naissance ou de baptême, "
    "« subject » = l'enfant. Dans un acte de décès ou un faire-part, « deceased » = la personne décédée et « relation » "
    "indique le lien de chaque proche avec elle. Dans un recensement, mets chaque habitant dans « households » "
    "(le chef de ménage a relation_to_head « chef ») et laisse « persons » vide. Dans un registre matricule, "
    "« subject » = le conscrit et remplis « military ». Dans une table décennale ou un index, remplis « entries ». "
    "Les parents décédés (« feu », « défunt », « décédé ») ont deceased = true. N'invente jamais un nom, une date ou un lien ; "
    "mets null si l'information est absente ; si tu hésites, confidence « low ». Les âges sont des nombres."
)

SYSTEM_READ = (
    "Tu es un paléographe et généalogiste professionnel français, expert des actes d'état civil, registres paroissiaux, "
    "recensements, registres matricules militaires, tables décennales et faire-part (français, latin, allemand, italien, "
    "polonais…). Lis le document joint (image ou PDF) et réponds UNIQUEMENT par un objet JSON strict, sans commentaire.\n"
    "1) « transcription » : transcription fidèle et intégrale, ligne par ligne, orthographe d'origine conservée. Marque chaque "
    "mot illisible ou incertain entre crochets avec un point d'interrogation, par exemple [?Dupont]. Pour un tableau "
    "(recensement, table), une ligne par ligne du tableau, colonnes séparées par « | ».\n"
    "2) Les autres clés suivent ce schéma :\n" + EXTRACTION_SCHEMA + "\n" + EXTRACTION_RULES
)

SYSTEM_EXTRACT = (
    "Tu es un généalogiste professionnel. À partir de la transcription fournie, extrais les informations "
    "sous forme de JSON strict, sans rien inventer. Si une information est absente, mets null. Schéma :\n"
    + EXTRACTION_SCHEMA + "\n" + EXTRACTION_RULES
)


def kind_hint(kind: str | None) -> str:
    """Phrase ajoutée à la consigne quand l'utilisateur a indiqué le type de document."""
    if not kind or kind == "auto" or kind not in DOC_KINDS:
        return "Détermine toi-même le type de document."
    return f"L'utilisateur indique qu'il s'agit d'un document de type : « {DOC_KINDS[kind]} » (vérifie-le)."


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
    for key, t in (("table décennale", "decennial_table"), ("tables décennales", "decennial_table"),
                   ("registre matricule", "military_register"), ("matricule", "military_register"),
                   ("classe de", "military_register"), ("recensement", "census"), ("dénombrement", "census"),
                   ("chef de ménage", "census"), ("faire-part", "death_notice"), ("avis de décès", "death_notice"),
                   ("ont la douleur", "death_notice"), ("acte de naissance", "birth"), ("est né", "birth"),
                   ("baptême", "baptism"), ("baptisé", "baptism"), ("acte de mariage", "marriage"), ("mariage", "marriage"),
                   ("acte de décès", "death"), ("est décédé", "death"), ("inhumé", "burial"), ("atto di nascita", "birth"),
                   ("atto di morte", "death"), ("atto di matrimonio", "marriage"), ("baptizat", "baptism"),
                   ("sepult", "burial"), ("urodz", "birth"), ("zmar", "death")):
        if key in low:
            return t
    return "other"


_ROLE_SYNONYMS = {
    "sujet": "subject", "enfant": "subject", "child": "subject", "époux": "subject", "epoux": "subject", "groom": "subject",
    "père": "father", "pere": "father", "mère": "mother", "mere": "mother", "épouse": "spouse", "epouse": "spouse",
    "bride": "spouse", "conjoint": "spouse", "témoin": "witness", "temoin": "witness", "déclarant": "declarant",
    "parrain": "godfather", "marraine": "godmother", "défunt": "deceased", "defunt": "deceased", "décédé": "deceased",
    "head": "head_of_household", "chef": "head_of_household", "member": "household_member",
}
_DOC_SYNONYMS = {"naissance": "birth", "baptême": "baptism", "bapteme": "baptism", "mariage": "marriage", "décès": "death",
                 "deces": "death", "sépulture": "burial", "sepulture": "burial", "recensement": "census",
                 "military": "military_register", "matricule": "military_register", "table": "decennial_table",
                 "faire-part": "death_notice", "photo": "family_photo"}


def _to_int(v: Any) -> Optional[int]:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v)
    m = re.search(r"\d{1,4}", str(v))
    return int(m.group(0)) if m else None


def _clean_str(v: Any) -> Optional[str]:
    if v is None or isinstance(v, (dict, list)):
        return None
    t = str(v).strip()
    return t if t and t.lower() not in ("null", "none", "?", "-", "inconnu") else None


def _norm_sex(v: Any) -> Optional[str]:
    t = (_clean_str(v) or "").lower()
    if t in ("m", "h", "masculin", "homme", "male", "garçon", "garcon"):
        return "M"
    if t in ("f", "féminin", "feminin", "femme", "female", "fille"):
        return "F"
    return None


def _norm_person(p: Any, allowed_roles=PERSON_ROLES) -> Optional[dict]:
    if not isinstance(p, dict):
        return None
    out = dict(p)
    role = (_clean_str(p.get("role")) or "other").lower()
    role = _ROLE_SYNONYMS.get(role, role)
    out["role"] = role if role in allowed_roles else "other"
    for k in ("given_names", "surname", "birth_date", "birth_place", "occupation", "residence", "relation",
              "relation_to_head", "nationality"):
        if k in out:
            out[k] = _clean_str(out.get(k))
    out["sex"] = _norm_sex(p.get("sex"))
    out["age"] = _to_int(p.get("age"))
    if "birth_year" in out:
        out["birth_year"] = _to_int(p.get("birth_year"))
    out["deceased"] = bool(p.get("deceased")) if not isinstance(p.get("deceased"), str) else p["deceased"].lower() in ("true", "oui", "yes")
    conf = (_clean_str(p.get("confidence")) or "medium").lower()
    out["confidence"] = conf if conf in ("high", "medium", "low") else "medium"
    if out.get("birth_date"):
        out["birth_date_normalized"] = parse_gendate(out["birth_date"]).to_dict()
    return out


def normalize_extraction(ex: Any, transcription: str = "") -> dict:
    """Rend l'extraction (IA, copier-coller ou règles) conforme au schéma, sans rien ajouter d'inventé."""
    ex = dict(ex) if isinstance(ex, dict) else {}
    dt = (_clean_str(ex.get("document_type")) or "").lower()
    dt = _DOC_SYNONYMS.get(dt, dt)
    if dt not in DOCUMENT_TYPES:
        dt = _guess_doc_type(transcription) if transcription else "other"
    ex["document_type"] = dt
    for k in ("date", "date_iso", "event_date", "event_date_iso", "place", "act_number", "officer", "translation_fr", "summary_fr"):
        if k in ex:
            ex[k] = _clean_str(ex.get(k))
    ex["persons"] = [q for q in (_norm_person(p) for p in (ex.get("persons") or []) if isinstance(ex.get("persons"), list)) if q]
    households = []
    for h in ex.get("households") or [] if isinstance(ex.get("households"), list) else []:
        if not isinstance(h, dict):
            continue
        members = [q for q in (_norm_person({**m, "role": m.get("role") or "household_member"}) for m in (h.get("members") or [])
                               if isinstance(m, dict)) if q]
        households.append({"address": _clean_str(h.get("address")), "number": _clean_str(h.get("number")), "members": members})
    ex["households"] = households
    entries = []
    for e in ex.get("entries") or [] if isinstance(ex.get("entries"), list) else []:
        if isinstance(e, dict):
            ent = {k: _clean_str(e.get(k)) for k in ("event_type", "date", "date_iso", "given_names", "surname", "spouse", "note")}
            if ent["event_type"] not in ("birth", "marriage", "death"):
                ent["event_type"] = "birth" if not ent["event_type"] else _DOC_SYNONYMS.get(ent["event_type"].lower(), "birth")
            entries.append(ent)
    ex["entries"] = entries
    if not isinstance(ex.get("military"), dict):
        ex["military"] = None
    if not isinstance(ex.get("relations"), list):
        ex["relations"] = []
    if not isinstance(ex.get("uncertain_passages"), list):
        ex["uncertain_passages"] = []
    # Dates normalisées (la forme écrite est conservée à part)
    if ex.get("date") or ex.get("date_iso"):
        gd = parse_gendate(ex.get("date_iso") or ex.get("date"))
        if gd.kind == "unknown" and ex.get("date"):
            gd = parse_gendate(ex["date"])
        d = gd.to_dict()
        d["original"] = ex.get("date") or ex.get("date_iso")
        ex["date_normalized"] = d
    if ex.get("event_date") or ex.get("event_date_iso"):
        gd = parse_gendate(ex.get("event_date_iso") or ex.get("event_date"))
        d = gd.to_dict()
        d["original"] = ex.get("event_date") or ex.get("event_date_iso")
        ex["event_date_normalized"] = d
    return ex


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


_NATIVE_MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
                ".gif": "image/gif", ".heic": "image/heic", ".pdf": "application/pdf"}
MAX_INLINE_BYTES = 18 * 1024 * 1024  # limite des requêtes en ligne (Gemini ≈ 20 Mo)


def media_attachment(media: Media, provider: str) -> tuple[bytes, str]:
    """Fichier original à joindre à l'appel IA (image ou PDF, sans conversion quand le modèle l'accepte)."""
    from ..services import storage

    name = (media.original_filename or media.path or "").lower()
    ext = Path(name).suffix
    mime = media.mime_type if media.mime_type in _NATIVE_MIME.values() else _NATIVE_MIME.get(ext)
    data = storage.read_bytes(media.path)
    accepted = {"gemini": set(_NATIVE_MIME.values()),
                "anthropic": {"image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"}}.get(provider, set())
    if mime in accepted and len(data) <= MAX_INLINE_BYTES:
        return data, mime
    if mime == "application/pdf":
        if len(data) > MAX_INLINE_BYTES:
            raise RuntimeError("PDF trop volumineux pour une lecture en ligne (18 Mo maximum) : importez la page de l'acte en image.")
        raise RuntimeError("Ce modèle ne lit pas les PDF : importez une photo (JPEG/PNG) de l'acte.")
    # Autres formats (TIFF, BMP, image trop lourde) : conversion en JPEG redimensionné, l'original reste intact
    from PIL import Image

    with Image.open(io.BytesIO(data)) as im:
        im = im.convert("RGB")
        if max(im.size) > 3000:
            ratio = 3000 / max(im.size)
            im = im.resize((int(im.width * ratio), int(im.height * ratio)))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=88)
        return buf.getvalue(), "image/jpeg"


def read_document_ai(ai: AIClient, media: Media, kind: str | None = None) -> tuple[str, dict, str]:
    """Lecture en UN appel : le fichier (image ou PDF) est joint, le modèle renvoie transcription + JSON structuré."""
    data, mime = media_attachment(media, ai.provider)
    user = ("Lis ce document d'archives et renvoie le JSON demandé (transcription + extraction). "
            + kind_hint(kind) + f" Nom du fichier : {media.original_filename or media.title or ''}.")
    r = ai.complete(SYSTEM_READ, user, purpose=f"lecture document {media.id}", personal=True, json_mode=True,
                    max_tokens=8000, attachments=[(data, mime)],
                    subject_person_ids=[media.person_id] if media.person_id else None)
    try:
        payload = r.json()
    except ValueError:
        # Le modèle a répondu en texte libre : on garde le texte comme transcription
        return r.text.strip(), {}, f"ai:{r.provider}:{r.model}"
    if isinstance(payload, list):
        payload = payload[0] if payload and isinstance(payload[0], dict) else {}
    transcription = str(payload.pop("transcription", "") or "").strip()
    payload["method"] = f"ai:{r.provider}"
    return transcription, payload, f"ai:{r.provider}:{r.model}"


def analyze_media(db: Session, media: Media, *, engine: str | None = None, kind: str | None = None) -> AnalysisResult:
    """Transcription + extraction structurée. Gemini / Claude : fichier joint, un seul appel. Sinon OCR + règles."""
    import time

    engine = engine or cfg.get(db, "ocr_engine", "auto")
    kind = kind or (media.analysis or {}).get("requested_kind")
    ai = AIClient(db)
    warnings: list[str] = []
    transcription, words, method = "", [], "none"
    extraction: dict = {}
    t0 = time.monotonic()

    use_ai = engine in ("auto", "ai") and ai.available()
    if use_ai and ai.provider in ("gemini", "anthropic"):
        try:
            transcription, extraction, method = read_document_ai(ai, media, kind)
        except (AIUnavailable, RuntimeError) as exc:
            warnings.append(f"Lecture IA indisponible : {exc}")
    images: list[bytes] | None = None
    if use_ai and not transcription and ai.provider == "ollama":
        try:
            images = load_images(storage_local(media))
            r = ai.complete(SYSTEM_TRANSCRIBE, "Transcris ce document historique. Marque les mots incertains entre [?]. "
                            + kind_hint(kind), purpose=f"transcription document {media.id}", personal=True, images=images,
                            max_tokens=4000, subject_person_ids=[media.person_id] if media.person_id else None)
            transcription, method = r.text, f"ai:{r.provider}:{r.model}"
        except (AIUnavailable, RuntimeError) as exc:
            warnings.append(f"Transcription IA indisponible : {exc}")
    tess = tesseract_available(db) if engine in ("auto", "tesseract") else None
    if not transcription and tess:
        try:
            if images is None:
                images = load_images(storage_local(media))
            transcription, words = ocr_tesseract(images, tess)
            method = "tesseract"
            warnings.append("OCR Tesseract : adapté aux imprimés, peu fiable sur l'écriture manuscrite ancienne.")
        except Exception as exc:  # pragma: no cover - dépend de l'installation
            warnings.append(f"Tesseract a échoué : {exc}")
    if not transcription and not extraction:
        if engine == "none" or (not use_ai and not tess):
            warnings.append("Aucun moteur de transcription disponible (configurez Gemini, gratuit, ou utilisez le mode "
                            "copier-coller avec Claude / ChatGPT). Le document est conservé ; vous pouvez aussi saisir "
                            "la transcription manuellement.")
        return AnalysisResult("", "none", "?", {"persons": [], "relations": []}, warnings=warnings)

    uncertain = re.findall(r"\[\?([^\]]*)\]", transcription)
    language = detect_language(transcription)
    if not extraction and ai.available() and transcription and time.monotonic() - t0 < 150:
        try:
            r = ai.complete(SYSTEM_EXTRACT, f"{kind_hint(kind)}\nTranscription :\n\n{transcription}", purpose=f"extraction {media.id}",
                            personal=True, json_mode=True, max_tokens=4000,
                            subject_person_ids=[media.person_id] if media.person_id else None)
            extraction = r.json()
            if not isinstance(extraction, dict):
                extraction = {}
            extraction["method"] = f"ai:{r.provider}"
        except (AIUnavailable, ValueError) as exc:
            warnings.append(f"Extraction IA indisponible, repli sur les règles : {exc}")
    if not extraction:
        extraction = rule_based_extract(transcription)
    method_ex = extraction.get("method")
    extraction = normalize_extraction(extraction, transcription)
    extraction["method"] = method_ex or method
    if kind and kind != "auto":
        extraction["requested_kind"] = kind
    if isinstance(extraction.get("language"), str) and extraction["language"] not in ("?", ""):
        language = extraction["language"]
    uncertain = uncertain or [str(u) for u in extraction.get("uncertain_passages") or []]
    return AnalysisResult(transcription, method, language, extraction, words, uncertain, warnings)


def storage_local(media: Media) -> Path:
    from ..services import storage

    return storage.local_copy(media.path)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------- Mode copier-coller (Claude.ai / ChatGPT par abonnement) ----------
MANUAL_PROMPT = (
    "Tu es un paléographe et généalogiste professionnel. Je joins l'image (ou le PDF) d'un document d'archives "
    "(acte d'état civil, registre paroissial, recensement, registre matricule, table décennale, faire-part…).\n\n"
    "1) TRANSCRIPTION : transcris fidèlement le document, ligne par ligne, sans rien inventer. Marque chaque mot "
    "illisible ou incertain entre crochets avec un point d'interrogation, par exemple [?Dupont]. Pour un tableau, "
    "une ligne par ligne du tableau, colonnes séparées par « | ».\n\n"
    "2) EXTRACTION : ensuite, sur une ligne seule, écris exactement ===JSON=== puis un objet JSON strict (sans commentaire) "
    "avec ce schéma, en mettant null quand l'information est absente :\n"
    + EXTRACTION_SCHEMA + "\n\n" + EXTRACTION_RULES + "\n\n"
    "Règles : n'invente aucun nom, aucune date ; si tu hésites, mets confidence \"low\" ; ne reformule pas la transcription."
)


def manual_prompt(media: Media, kind: str | None = None) -> str:
    kind = kind or (media.analysis or {}).get("requested_kind")
    hint = f"Nom du fichier : {media.original_filename or media.title or ''}."
    return f"{MANUAL_PROMPT}\n\n{kind_hint(kind)} {hint}"


def parse_manual_answer(text: str) -> AnalysisResult:
    """Analyse une réponse collée depuis claude.ai / chatgpt.com (transcription + ===JSON===)."""
    import json as _json

    raw = (text or "").strip()
    if not raw:
        raise ValueError("Réponse vide.")
    transcription, json_part = raw, ""
    if "===JSON===" in raw:
        transcription, json_part = raw.split("===JSON===", 1)
    else:
        start = raw.find("{")
        if start >= 0 and raw.rfind("}") > start:
            transcription, json_part = raw[:start], raw[start:]
    transcription = re.sub(r"```(?:json)?\s*$", "", transcription.strip()).strip()
    transcription = re.sub(r"^\s*(1\)|\*\*)?\s*TRANSCRIPTION\s*:?\s*(\*\*)?", "", transcription, flags=re.I).strip()
    extraction: dict = {}
    warnings: list[str] = []
    if json_part.strip():
        m = re.search(r"```(?:json)?\s*(.*?)```", json_part, re.S)
        candidate = m.group(1) if m else json_part
        start, end = candidate.find("{"), candidate.rfind("}")
        if start != -1 and end != -1:
            try:
                extraction = _json.loads(candidate[start:end + 1])
            except ValueError as exc:
                warnings.append(f"JSON illisible ({exc}) : extraction par règles utilisée.")
    if not extraction or not isinstance(extraction, dict):
        extraction = rule_based_extract(transcription)
    if not isinstance(extraction, dict):
        extraction = {}
    pasted_tr = extraction.pop("transcription", None)
    if not transcription and isinstance(pasted_tr, str):
        transcription = pasted_tr.strip()  # JSON complet collé (transcription incluse)
    extraction = normalize_extraction(extraction, transcription)
    extraction["method"] = "manual_llm"
    uncertain = re.findall(r"\[\?([^\]]*)\]", transcription)
    language = extraction.get("language") if isinstance(extraction.get("language"), str) and extraction.get("language") != "?" else detect_language(transcription)
    warnings.append("Réponse d'un assistant externe collée manuellement : vérifiez l'image avant toute validation.")
    return AnalysisResult(transcription, "manual_llm", language or "?", extraction, [], uncertain, warnings)

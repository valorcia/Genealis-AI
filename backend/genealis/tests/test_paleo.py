"""Lecture des écritures anciennes : images synthétiques (Pillow), Gemini simulé (aucun accès réseau).

Ces tests vérifient le pipeline (original intact, versions, coordonnées, passages incertains, seconde passe agrandie,
corrections réutilisées, photo sans identification, mentions, CER/WER, protections). Ils ne mesurent PAS la capacité
de Gemini à lire une écriture ancienne réelle : voir docs/PALEOGRAPHIE.md (protocole de test réel).
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
from pathlib import Path

import httpx
import pytest
from PIL import Image, ImageDraw, ImageFont

from genealis.models import DocumentReading, Media, PersonMention, ReadingCorrection, Source
from genealis.paleo import benchmark, mentions, preprocess, prompts, read_document
from genealis.paleo.mentions import parse_relation
from genealis.services import settings_service as cfg
from genealis.services import storage
from genealis.services.media_service import import_file
from genealis.tests.fixtures import build_fictional_family

REF = benchmark.get_ref("synthetique-bapteme-fr-1650")
REF_LINES = REF["reference_text"].split("\n")
W, H = 1400, 900
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"


def _font(size=30):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:  # pragma: no cover - police absente
        return ImageFont.load_default()


def draw_document(lines: list[str], size=(W, H), seed_text: str = "") -> tuple[bytes, list[list[int]]]:
    """Image synthétique (texte dessiné) et zones réelles de chaque ligne en 0-1000 [x, y, w, h]."""
    im = Image.new("RGB", size, (236, 226, 200))
    d = ImageDraw.Draw(im)
    f = _font()
    boxes = []
    for i, ln in enumerate(lines):
        x, y = 50, 70 + i * 140
        d.text((x, y), ln, fill=(60, 40, 20), font=f)
        x0, y0, x1, y1 = d.textbbox((x, y), ln, font=f)
        boxes.append([round(x0 / size[0] * 1000), round(y0 / size[1] * 1000), round((x1 - x0) / size[0] * 1000),
                      round((y1 - y0) / size[1] * 1000)])
    if seed_text:
        d.text((10, size[1] - 40), seed_text, fill=(120, 100, 80), font=_font(16))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue(), boxes


def box2d(b):  # [x, y, w, h] → [ymin, xmin, ymax, xmax]
    return [b[1], b[0], b[1] + b[3], b[0] + b[2]]


def reading_payload(lines: list[str], boxes: list[list[int]], *, persons=None, uncertain_line=2) -> dict:
    out_lines = []
    for i, (t, b) in enumerate(zip(lines, boxes)):
        ln = {"n": i + 1, "box_2d": box2d(b), "diplomatic": t, "normalized": t.replace("parr.", "paroisse"), "translation": None,
              "uncertain": []}
        if i + 1 == uncertain_line:
            word = t.split()[-1]
            wx = b[0] + int(b[2] * 0.6)
            ln["uncertain"] = [{"text": word, "alternatives": [word + "e"], "reason": "lettre ambiguë", "confidence": 0.35,
                                "box_2d": [b[1], wx, b[1] + b[3], wx + int(b[2] * 0.25)]}]
        out_lines.append(ln)
    return {"document_kind": "register_page", "script_type": "french_cursive", "script_confidence": 0.8, "language": "fr",
            "period_estimate": "vers 1650", "zones": [{"box_2d": [50, 20, 700, 980], "kind": "text"}], "lines": out_lines,
            "translation": None,
            "extraction": {"document_type": "baptism", "date": "douziesme iour de mars mil six cens cinquante", "date_iso": "1650-03-12",
                           "place": "paroisse (fictive)", "persons": persons or [
                               {"role": "subject", "name_original": "Claude", "given_names": "Claude", "surname": "Bertrin", "sex": "M",
                                "line_n": 2, "confidence": "high"},
                               {"role": "father", "name_original": "Nicolas Bertrin", "given_names": "Nicolas", "surname": "Bertrin",
                                "occupation": "manouurier", "line_n": 2, "confidence": "medium"},
                               {"role": "godfather", "name_original": "Claude Mouginot", "given_names": "Claude", "surname": "Mouginot",
                                "stated_relation": "oncle maternel de lenfant", "line_n": 4, "confidence": "high"},
                               {"role": "godmother", "name_original": "Anne Thiriet", "given_names": "Anne", "surname": "Thiriet",
                                "signed": False, "line_n": 5, "confidence": "high"}],
                           "summary_fr": "Baptême (fictif) de Claude Bertrin en 1650."},
            "quality": {"legibility": "medium", "problems": ["encre pâle"], "self_assessment": "lecture plausible"}}


class FakeGemini:
    """Remplace httpx.post : répond selon la consigne (lecture, seconde passe, photo) et mémorise les envois."""

    def __init__(self):
        self.calls: list[dict] = []
        self.reading: dict = {}
        self.second: dict = {"readings": [{"text": "Bertrim", "confidence": 0.55, "evidence": "jambage final"}], "best": "Bertrim",
                             "agrees_with_initial": False, "can_decide": False, "notes": "m ou n ?"}
        self.photo: dict = {}
        self.status = 200

    def post(self, url, params=None, json=None, timeout=None, **kw):
        body = json or {}
        system = body["system_instruction"]["parts"][0]["text"]
        parts = body["contents"][0]["parts"]
        images = [base64.b64decode(p["inline_data"]["data"]) for p in parts if "inline_data" in p]
        self.calls.append({"system": system, "user": parts[0]["text"], "images": images})
        req = httpx.Request("POST", url)
        if self.status != 200:
            return httpx.Response(self.status, text='{"error": {"details": [{"retryDelay": "30s"}]}}', request=req)
        if "DÉCOUPE AGRANDIE" in system:
            payload = self.second
        elif "photographie ancienne" in system:
            payload = self.photo
        else:
            payload = self.reading
        import json as _j

        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": _j.dumps(payload, ensure_ascii=False)}]},
                                                         "finishReason": "STOP"}],
                                         "usageMetadata": {"promptTokenCount": 900, "candidatesTokenCount": 400}}, request=req)

    def of(self, kind: str) -> list[dict]:
        key = {"second": "DÉCOUPE AGRANDIE", "photo": "photographie ancienne"}.get(kind)
        if kind == "read":
            return [c for c in self.calls if "DÉCOUPE AGRANDIE" not in c["system"] and "photographie ancienne" not in c["system"]]
        return [c for c in self.calls if key in c["system"]]


@pytest.fixture
def gemini(db, monkeypatch):
    cfg.set_value(db, "ai_provider", "gemini")
    cfg.set_value(db, "gemini_api_key", "cle-de-test")
    cfg.set_value(db, "allow_external_ai", True)
    cfg.set_value(db, "ai_minute_call_limit", 0)
    fake = FakeGemini()
    monkeypatch.setattr(httpx, "post", fake.post)
    return fake


def _import(db, tmp_path: Path, data: bytes, name="acte.png", kind="document", person_id=None, source_id=None) -> Media:
    p = tmp_path / name
    p.write_bytes(data)
    return import_file(db, p, original_filename=name, kind=kind, person_id=person_id, source_id=source_id)


def _sha(media: Media) -> str:
    return hashlib.sha256(storage.read_bytes(media.path)).hexdigest()


# ---------------------------------------------------------------------------------------------------------------
def test_lecture_original_intact_versions_et_zones(db, gemini, tmp_path):
    data, boxes = draw_document(REF_LINES)
    m = _import(db, tmp_path, data)
    sha_before = _sha(m)
    gemini.reading = reading_payload(REF_LINES, boxes)
    r1 = read_document(db, m, options={"second_pass": False})
    r2 = read_document(db, m, options={"second_pass": False})  # écriture connue : consigne spécialisée
    r3 = read_document(db, m, options={"second_pass": False})
    assert (r1.version, r2.version, r3.version) == (1, 2, 3) and len({r1.id, r2.id, r3.id}) == 3
    assert "Cursive française" in gemini.of("read")[1]["user"], "la 2e lecture utilise les consignes de l'écriture identifiée"
    assert len(gemini.of("read")) == 2, "une lecture identique vient du cache (aucun nouvel envoi)"
    assert r3.preprocessing["cached"] is True
    r2 = r3
    assert _sha(m) == sha_before == m.sha256, "l'original n'est jamais modifié"
    assert r1.preprocessing["original_sha256"] == sha_before and r1.preprocessing["original_untouched"]
    assert "contraste automatique" in r1.preprocessing["operations"]
    # zones converties de [ymin, xmin, ymax, xmax] vers [x, y, w, h], relatives à l'original
    assert len(r1.lines) == 5 and all(ln["bbox"] for ln in r1.lines)
    for ln, b in zip(r1.lines, boxes):
        assert all(abs(a - e) <= 1 for a, e in zip(ln["bbox"], b))
    assert r1.zones and r1.zones[0]["bbox"] == [20, 50, 960, 650]
    # passage incertain conservé, la ligne n'est pas « corrigée » en silence
    unc = r1.lines[1]["uncertain"][0]
    assert unc["text"] == "Bertrin" and unc["status"] == "uncertain" and unc["alternatives"] == ["Bertrine"]
    assert r1.lines[1]["diplomatic"] == REF_LINES[1]
    assert r1.diplomatic == REF["reference_text"] and r1.normalized and "paroisse" in r1.normalized
    assert r1.script_type == "french_cursive" and r1.language == "fr" and r1.translation is None
    assert any("à vérifier" in w for w in r1.warnings)
    # les écrans v0.3 affichent la dernière lecture
    assert m.ocr_text == r2.diplomatic and m.analysis["reading_id"] == r2.id and m.analysis_status == "done"
    assert m.analysis["extraction"]["document_type"] == "baptism" and "Bertrin" in m.analysis["uncertain"]
    # consigne : diplomatique / normalisée / incertitudes / consignes propres à l'écriture
    sent = gemini.of("read")[0]
    assert "DIPLOMATIQUE" in sent["system"] and "JAMAIS présentée comme certaine" in sent["system"]
    assert "s long" in sent["user"] or "Identifie d'abord l'écriture" in sent["user"]


def test_transformations_vers_original():
    t = preprocess.Transform(crop=None, rotate=90)
    # sur la copie tournée de 90° (horaire), le coin haut-gauche correspond au bas-gauche de l'original
    assert t.bbox_to_original([0, 0, 100, 200]) == [0, 900, 200, 100]
    assert preprocess.Transform(rotate=180).bbox_to_original([0, 0, 100, 100]) == [900, 900, 100, 100]
    assert preprocess.Transform(rotate=270).bbox_to_original([0, 0, 100, 200]) == [800, 0, 200, 100]
    crop = preprocess.Transform(crop=(500, 500, 500, 500))
    assert crop.bbox_to_original([0, 0, 1000, 1000]) == [500, 500, 500, 500]
    assert crop.bbox_to_original([500, 500, 200, 200]) == [750, 750, 100, 100]
    assert preprocess.box2d_to_bbox([100, 200, 300, 500]) == [200, 100, 300, 200]


def test_lecture_copie_tournee_coordonnees_originales(db, gemini, tmp_path):
    data, boxes = draw_document(REF_LINES[:2])
    m = _import(db, tmp_path, data)
    gemini.reading = {"lines": [{"n": 1, "box_2d": [0, 0, 100, 200], "diplomatic": "Le douziesme"}], "script_type": "french_cursive",
                      "language": "fr"}
    r = read_document(db, m, options={"rotate": 90, "second_pass": False})
    sent = Image.open(io.BytesIO(gemini.of("read")[0]["images"][0]))
    assert sent.size == (H, W), "la copie envoyée est tournée, pas l'original"
    assert r.lines[0]["bbox"] == [0, 800, 100, 200] and r.preprocessing["transform"]["rotate"] == 90


def test_seconde_passe_image_recadree_et_agrandie(db, gemini, tmp_path):
    data, boxes = draw_document(REF_LINES)
    m = _import(db, tmp_path, data)
    gemini.reading = reading_payload(REF_LINES, boxes)
    r = read_document(db, m, options={"second_pass": True})
    sp_calls = gemini.of("second")
    assert len(sp_calls) == 1, "seconde passe uniquement pour le passage incertain"
    sent = Image.open(io.BytesIO(sp_calls[0]["images"][0]))
    entry = r.lines[1]["uncertain"][0]
    cx, cy, cw, ch = entry["second_pass"]["crop_bbox"]
    region_px = (cw / 1000 * W, ch / 1000 * H)
    assert sent.size[0] > region_px[0] * 1.5 and sent.size[1] > region_px[1] * 1.5, "la zone est agrandie"
    assert max(sent.size) >= 1000 and abs(sent.size[0] / sent.size[1] - region_px[0] / region_px[1]) < 0.05
    ux, uy, uw, uh = entry["bbox"]
    assert cx <= ux and cy <= uy and cx + cw >= ux + uw and cy + ch >= uy + uh, "la découpe contient le passage et du contexte"
    assert sent.size[0] < W * 2 or cw < 1000, "ce n'est pas la page entière renvoyée"
    assert "Bertrin" in sp_calls[0]["user"] and "lus avec certitude" in sp_calls[0]["user"]
    # seconde passe non concordante : rien n'est remplacé, la lecture reste incertaine, alternatives classées
    assert r.lines[1]["diplomatic"] == REF_LINES[1]
    assert entry["status"] == "uncertain" and entry["second_pass"]["status"] == "undecided" and not entry["second_pass"]["agrees"]
    assert entry["alternatives"][0] == "Bertrim" and "Bertrine" in entry["alternatives"]
    assert entry["ranked"][0]["source"] == "second_pass"
    assert r.quality["second_pass_done"] == 1


def test_seconde_passe_plafonnee(db, gemini, tmp_path):
    lines = [f"ligne {i} avec motxx{i} douteux" for i in range(9)]
    data, boxes = draw_document(lines, size=(1400, 1400))
    m = _import(db, tmp_path, data)
    payload = reading_payload(lines, boxes, uncertain_line=0)
    for ln in payload["lines"]:
        ln["uncertain"] = [{"text": ln["diplomatic"].split()[3], "alternatives": [], "confidence": 0.3, "box_2d": ln["box_2d"]}]
    gemini.reading = payload
    r = read_document(db, m)
    assert len(gemini.of("second")) == 6 and r.quality["second_pass_done"] == 6
    assert any("plafond" in w for w in r.warnings)


def test_correction_humaine_reinjectee_meme_main(client, db, gemini, tmp_path):
    src = Source(title="Registre BMS fictif", repository="AD fictives", commune="Villefictive", register_type="BMS", reference="E 999")
    db.add(src)
    db.flush()
    data, boxes = draw_document(REF_LINES)
    m1 = _import(db, tmp_path, data, "p1.png", source_id=src.id)
    wrong = list(REF_LINES)
    wrong[1] = wrong[1].replace("Bertrin", "Bertin")
    gemini.reading = reading_payload(wrong, boxes)
    r1 = read_document(db, m1, options={"second_pass": False})
    assert r1.scribe_key and r1.scribe_key.startswith("src:")
    db.commit()
    res = client.patch(f"/api/readings/{r1.id}/lines/2", json={"text": REF_LINES[1], "note": "vérifié sur l'image"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["lines"][1]["diplomatic"] == REF_LINES[1] and body["status"] == "reviewed"
    assert body["lines"][1]["uncertain"][0]["status"] == "human_verified"
    assert body["corrections"][0]["before"] == wrong[1] and body["diplomatic"].split("\n")[1] == REF_LINES[1]
    db.expire_all()
    corr = db.query(ReadingCorrection).one()
    assert corr.scribe_key == r1.scribe_key and corr.script_type == "french_cursive"
    assert db.get(Media, m1.id).ocr_text.split("\n")[1] == REF_LINES[1]
    # autre page du même registre : la correction est réinjectée dans la consigne et signalée (sans remplacement)
    data2, boxes2 = draw_document(wrong, seed_text="page 2")
    m2 = _import(db, tmp_path, data2, "p2.png", source_id=src.id)
    gemini.reading = reading_payload(wrong, boxes2)
    r2 = read_document(db, db.get(Media, m2.id), options={"second_pass": False})
    last = gemini.of("read")[-1]["user"]
    assert "MÊME MAIN" in last and "« Bertin » → « Bertrin »" in last
    assert r2.lines[1]["diplomatic"] == wrong[1], "jamais de remplacement silencieux"
    assert r2.lines[1]["suggestions"][0]["after"] == "Bertrin"
    # autre registre, même écriture : réinjectée comme indication « même type d'écriture »
    data3, boxes3 = draw_document(wrong, seed_text="autre registre")
    m3 = _import(db, tmp_path, data3, "p3.png")
    read_document(db, m3, options={"second_pass": False, "script_type": "french_cursive"})
    last = gemini.of("read")[-1]["user"]
    assert "même type d'écriture" in last and "MÊME MAIN" not in last


def test_photo_sans_reconnaissance_faciale(db, gemini, tmp_path):
    im = Image.new("RGB", (800, 1100), (200, 190, 170))
    ImageDraw.Draw(im).text((300, 1000), "Phot. Studio Fictif - Nancy", fill=(50, 40, 30), font=_font(22))
    buf = io.BytesIO()
    im.save(buf, format="JPEG")
    m = _import(db, tmp_path, buf.getvalue(), "photo.jpg", kind="photo")
    gemini.photo = {"description": "Portrait de groupe ; l'homme ressemble à Jean Durant", "visible_elements": ["chaise", "toile peinte"],
                    "people_count": 2,
                    "people": [{"position": "assis", "clothing": "redingote", "name": "Jean Durant", "identity": "Jean Durant"},
                               {"position": "debout", "clothing": "robe à col haut", "objects": "éventail", "identified_as": "Marie"}],
                    "inscriptions": [{"text": "Phot. Studio Fictif - Nancy", "location": "recto bas", "box_2d": [900, 360, 930, 640]}],
                    "photographer_stamp": {"text": "Phot. Studio Fictif", "studio": "Studio Fictif", "city": "Nancy"},
                    "geographic_clues": ["Nancy (cachet)"], "period_estimate": {"range": "1890-1910", "clues": ["format carte album"]}}
    r = read_document(db, m)
    call = gemini.of("photo")[0]
    assert prompts.PHOTO_NO_FACE_RULE in call["system"] and prompts.PHOTO_NO_FACE_RULE in call["user"]
    stored = json.dumps({"p": r.photo_analysis, "l": r.lines, "e": r.extraction, "a": db.get(Media, m.id).analysis}, ensure_ascii=False)
    assert "Jean Durant" not in stored and "Marie" not in stored
    assert all(set(p) <= {"position", "clothing", "objects", "posture", "apparent_age_group"} for p in r.photo_analysis["people"])
    assert r.photo_analysis["photographer_stamp"]["city"] == "Nancy" and r.photo_analysis["period_estimate"]["range"] == "1890-1910"
    assert r.lines[0]["diplomatic"] == "Phot. Studio Fictif - Nancy" and r.lines[0]["bbox"]
    assert r.document_kind == "photo" and r.extraction["persons"] == []
    assert mentions.mentions_from_reading(db, r) == [] and db.query(PersonMention).count() == 0


def test_mentions_relation_indirecte(client, db, gemini, tmp_path):
    f = build_fictional_family(db)
    lines = ["Ont été mariés Jean Marie Durant et Marie Kowalska", "en présence de Jan Nowak oncle maternel de l'épouse",
             "et de Paul Martin ami de l'époux"]
    data, boxes = draw_document(lines)
    m = _import(db, tmp_path, data, "mariage.png")
    persons = [
        {"role": "groom", "name_original": "Jean Marie Durant", "given_names": "Jean Marie", "surname": "Durant", "sex": "M", "line_n": 1,
         "confidence": "high", "age": "vingt-sept ans"},
        {"role": "bride", "name_original": "Marie Kowalska", "given_names": "Marie", "surname": "Kowalska", "sex": "F", "line_n": 1},
        {"role": "witness", "name_original": "Jan Nowak", "given_names": "Jan", "surname": "Nowak", "stated_relation":
            "oncle maternel de l'épouse", "occupation": "mineur", "residence": "Nancy", "signed": True, "line_n": 2},
        {"role": "witness", "name_original": "Paul Martin", "given_names": "Paul", "surname": "Martin", "stated_relation": "ami de l'époux"},
    ]
    payload = reading_payload(lines, boxes, persons=persons, uncertain_line=0)
    payload["extraction"].update({"document_type": "marriage", "date_iso": "1956-04-12", "place": "Nancy"})
    gemini.reading = payload
    r = read_document(db, m, options={"second_pass": False})
    db.commit()
    res = client.post(f"/api/readings/{r.id}/mentions", json={})
    assert res.status_code == 200, res.text
    ms = {x["name_original"]: x for x in res.json()}
    nowak = ms["Jan Nowak"]
    assert (nowak["role"], nowak["relation_kind"], nowak["relation_side"], nowak["relation_to_role"]) == ("witness", "uncle", "maternal", "bride")
    assert nowak["relation_to_mention_id"] == ms["Marie Kowalska"]["id"]
    assert nowak["signed"] is True and nowak["occupation"] == "mineur" and nowak["image_region"]["line_n"] == 2
    assert nowak["image_region"]["bbox"] == r.lines[1]["bbox"] and "oncle maternel" in nowak["excerpt"]
    assert ms["Paul Martin"]["relation_kind"] == "friend" and ms["Paul Martin"]["relation_to_role"] == "groom"
    assert ms["Jean Marie Durant"]["role"] == "groom" and ms["Jean Marie Durant"]["age_stated"] == "vingt-sept ans"
    assert all(x["linked_person_id"] is None for x in ms.values()), "aucun lien automatique vers l'arbre"
    jm = ms["Jean Marie Durant"]
    assert jm["link_status"] == "candidate" and any(c["person_id"] == f["gf"].id for c in jm["candidates"])
    assert all("jamais automatique" in w for c in jm["candidates"] for w in c["warnings"][-1:])
    # idempotent
    assert len(client.post(f"/api/readings/{r.id}/mentions", json={}).json()) == 4
    assert db.query(PersonMention).count() == 4


def test_analyse_des_relations_multilingue():
    assert parse_relation("oncle maternel de l'épouse") == ("uncle", "maternal", "bride")
    assert parse_relation("patruus infantis") == ("uncle", "paternal", "subject")
    assert parse_relation("cousin germain du défunt") == ("cousin", "unknown", "deceased")
    assert parse_relation("frère de l'époux") == ("brother", None, "groom")
    assert parse_relation("zio paterno della sposa") == ("uncle", "paternal", "bride")
    assert parse_relation("wuj panny młodej")[:2] == ("uncle", "maternal")
    assert parse_relation(None) == (None, None, None)


def test_benchmark_cer_wer_exacts(client, db, gemini, tmp_path):
    assert benchmark.cer("abcd", "abed") == 0.25
    assert benchmark.wer("le chat noir", "le chien noir") == pytest.approx(1 / 3)
    assert benchmark.cer("abc", "abc") == 0 and benchmark.cer("", "x") is None
    rep = benchmark.compare("Le ſieur Jean\nfils de Pierre", "le sieur Jean\nfils de Pierre")
    assert rep["cer"] == pytest.approx(2 / 28, abs=1e-4) and rep["cer_normalized"] == 0 and rep["wer"] == round(2 / 6, 4)
    assert rep["lines"][0]["distance"] == 2 and rep["lines"][1]["cer"] == 0
    assert benchmark.compare("iour [?Bertrin]", "iour Bertrin")["cer"] == 0
    # lecture comparée à la référence synthétique (une erreur connue : « Bertin » au lieu de « Bertrin »)
    data, boxes = draw_document(REF_LINES)
    m = _import(db, tmp_path, data)
    wrong = list(REF_LINES)
    wrong[1] = wrong[1].replace("Bertrin", "Bertin")
    gemini.reading = reading_payload(wrong, boxes)
    r = read_document(db, m, options={"second_pass": False})
    db.commit()
    res = client.post("/api/paleo/benchmark", json={"reading_id": r.id, "ref_id": REF["id"]})
    assert res.status_code == 200, res.text
    flat = " ".join(REF["reference_text"].split())
    assert res.json()["cer"] == round(1 / len(flat), 4) and res.json()["wer"] == round(1 / len(flat.split()), 4)
    assert res.json()["synthetic"] is True and res.json()["lines"][1]["distance"] == 1
    lst = client.get("/api/paleo/benchmarks").json()
    assert lst["results"][0]["reading_id"] == r.id and any(x["id"] == REF["id"] and x["synthetic"] for x in lst["references"])
    assert all("SYNTHÉTIQUE" in x["title"] for x in lst["references"] if x.get("synthetic"))


def test_personne_vivante_refus(client, db, gemini, tmp_path):
    f = build_fictional_family(db)  # Camille : vivante
    data, _ = draw_document(["Document de Camille"])
    m = _import(db, tmp_path, data, person_id=f["me"].id)
    db.commit()
    res = client.post(f"/api/media/{m.id}/readings", json={})
    assert res.status_code == 403 and "vivante" in res.json()["detail"]
    assert gemini.calls == [] and db.query(DocumentReading).count() == 0


def test_quota_429(client, db, gemini, tmp_path):
    data, boxes = draw_document(REF_LINES[:2])
    m = _import(db, tmp_path, data)
    gemini.reading = reading_payload(REF_LINES[:2], boxes)
    cfg.set_value(db, "ai_daily_call_limit", 1)
    db.commit()
    assert client.post(f"/api/media/{m.id}/readings", json={"second_pass": False}).status_code == 201
    data2, _ = draw_document(["autre page"])
    m2 = _import(db, tmp_path, data2, "p2.png")
    db.commit()
    res = client.post(f"/api/media/{m2.id}/readings", json={})
    assert res.status_code == 429 and "Plafond" in res.json()["detail"]
    assert len(gemini.calls) == 1
    # quota du fournisseur (HTTP 429 de Google) → 429 aussi, et suspension des appels suivants
    cfg.set_value(db, "ai_daily_call_limit", 0)
    gemini.status = 429
    db.commit()
    res = client.post(f"/api/media/{m2.id}/readings", json={})
    assert res.status_code == 429 and "Quota Gemini" in res.json()["detail"]


def test_api_lecteur_complet(client, db, gemini, tmp_path):
    data, boxes = draw_document(REF_LINES)
    m = _import(db, tmp_path, data)
    payload = reading_payload(REF_LINES, boxes)
    payload["language"] = "la"
    payload["translation"] = "Traduction fictive."
    gemini.reading = payload
    db.commit()
    assert any(s["id"] == "kurrent" for s in client.get("/api/paleo/scripts").json()["scripts"])
    r = client.post(f"/api/media/{m.id}/readings", json={"script_type": "french_cursive", "translate_to": "fr", "second_pass": False})
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    assert r.json()["translation"] == "Traduction fictive." and r.json()["translation_language"] == "fr"
    sent_user = gemini.of("read")[-1]["user"]
    assert "Cursive française" in sent_user and "7bre" in sent_user
    assert client.get(f"/api/media/{m.id}/readings").json()[0]["id"] == rid
    # seconde analyse demandée sur une zone choisie par l'utilisateur
    rc = client.post(f"/api/readings/{rid}/recheck", json={"line_n": 4, "bbox": [400, 450, 200, 60], "text": "Mouginot"})
    assert rc.status_code == 200, rc.text
    assert rc.json()["passage"]["second_pass"]["status"] == "undecided"
    assert rc.json()["reading"]["lines"][3]["diplomatic"] == REF_LINES[3]
    v = client.post(f"/api/readings/{rid}/validate", json={})
    assert v.json()["status"] == "validated" and v.json()["quality"]["verified_by_human"]
    assert any("encore incertain" in w for w in v.json()["warnings"])
    # image dérivée à la volée, original intact
    sha = _sha(m)
    img = client.get(f"/api/media/{m.id}/view", params={"rotate": 90, "contrast": "auto", "negative": True, "gray": True,
                                                        "crop": "0,0,500,500", "max": 400})
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    out = Image.open(io.BytesIO(img.content))
    assert out.size == (int(400 * H / W), 400) or max(out.size) == 400
    assert _sha(m) == sha
    assert client.get(f"/api/media/{m.id}/view", params={"crop": "a,b"}).status_code == 400
    # copier-coller (abonnement) : consigne + réponse collée
    p = client.get(f"/api/media/{m.id}/readings/manual-prompt").json()
    assert "JSON" in p["prompt"] and p["file_url"].endswith("/file")
    manual = client.post(f"/api/media/{m.id}/readings", json={"engine": "manual", "manual_text": json.dumps(payload)})
    assert manual.status_code == 201 and manual.json()["engine"] == "manual_llm" and manual.json()["version"] == 2
    assert any("collée manuellement" in w for w in manual.json()["warnings"])


def test_htr_externe_desactive_par_defaut(client, db, gemini, tmp_path):
    from genealis.paleo.htr import ExternalHTR

    ok, why = ExternalHTR(db).available()
    assert not ok and "désactivé" in why
    cfg.set_value(db, "htr_external_url", "https://htr.example.org/read")
    assert "non autorisé" in ExternalHTR(db).available()[1]
    cfg.set_value(db, "htr_external_authorized", True)
    assert "GRATUIT" in ExternalHTR(db).available()[1], "un service en ligne (potentiellement payant) est refusé en mode gratuit"
    data, _ = draw_document(["x"])
    m = _import(db, tmp_path, data)
    db.commit()
    res = client.post(f"/api/media/{m.id}/readings", json={"engine": "external"})
    assert res.status_code == 503 and gemini.calls == []

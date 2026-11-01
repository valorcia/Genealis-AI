"""Import et interprétation des documents (acte de mariage, recensement) : lecture IA simulée, propositions, application."""
from __future__ import annotations

import io
import json

import pytest
from sqlalchemy import select

from genealis.ai import providers
from genealis.ai.documents import manual_prompt, parse_manual_answer
from genealis.ai.providers import AIClient, AIResponse
from genealis.models import Citation, Event, Family, Hypothesis, Media, ParentChild, Person, Question, Source
from genealis.services import settings_service as cfg
from genealis.services.interpret import apply_proposals, dates_compatible, get_proposals, kin_of
from genealis.services.gendate import parse_gendate
from genealis.services.media_service import import_file
from genealis.services.persons import parents_of, spouses_of
from genealis.tests.fixtures import build_fictional_family

MARRIAGE_TEXT = (
    "N° 212. L'an mil neuf cent cinquante-six, le douze avril, à dix heures, devant nous Louis [?Mangin], adjoint au maire, "
    "officier de l'état civil de la ville de Nancy, ont comparu publiquement Jean Marie DURANT, cheminot, né à Toul le "
    "quatorze mars mil neuf cent vingt-neuf, âgé de vingt-sept ans, domicilié à Nancy, fils de feu François DURANT, journalier, "
    "et de Jeanne PETIT, ménagère, domiciliée à Toul ; et Marie KOWALSKA, sans profession, née à Varsovie (Pologne) en mil neuf "
    "cent trente-deux, domiciliée à Nancy, fille de Stanislas KOWALSKI, mineur, et de Zofia NOWAK. En présence de Paul MARTIN, "
    "employé, âgé de vingt-six ans, témoin."
)


def marriage_json(date_iso="1956-04-12", written="le douze avril mil neuf cent cinquante-six", groom=("Jean Marie", "DURANT", "14 mars 1929", "Toul", 27),
                  bride=("Marie", "KOWALSKA", "1932", "Varsovie (Pologne)", 24), parents=True) -> dict:
    persons = [
        {"role": "subject", "given_names": groom[0], "surname": groom[1], "sex": "M", "age": groom[4], "birth_date": groom[2],
         "birth_place": groom[3], "occupation": "cheminot", "residence": "Nancy", "confidence": "high"},
        {"role": "spouse", "given_names": bride[0], "surname": bride[1], "sex": "F", "age": bride[4], "birth_date": bride[2],
         "birth_place": bride[3], "occupation": None, "residence": "Nancy", "confidence": "high"},
    ]
    if parents:
        persons += [
            {"role": "father", "given_names": "François", "surname": "DURANT", "occupation": "journalier", "deceased": True, "confidence": "high"},
            {"role": "mother", "given_names": "Jeanne", "surname": "PETIT", "occupation": "ménagère", "residence": "Toul", "confidence": "medium"},
            {"role": "spouse_father", "given_names": "Stanislas", "surname": "KOWALSKI", "occupation": "mineur", "confidence": "high"},
            {"role": "spouse_mother", "given_names": "Zofia", "surname": "NOWAK", "confidence": "medium"},
        ]
    persons.append({"role": "witness", "given_names": "Paul", "surname": "MARTIN", "age": 26, "occupation": "employé", "confidence": "medium"})
    return {"transcription": MARRIAGE_TEXT, "document_type": "marriage", "language": "fr", "date": written, "date_iso": date_iso,
            "place": "Nancy, Meurthe-et-Moselle", "act_number": "212", "officer": "Louis [?Mangin], adjoint au maire",
            "persons": persons, "households": [], "military": None, "entries": [], "relations": [],
            "uncertain_passages": ["Mangin"], "translation_fr": None, "summary_fr": "Mariage de Jean Marie Durant et Marie Kowalska à Nancy en 1956."}


CENSUS = {
    "transcription": "Toul — Recensement de 1936 — Rue de la Gare\n12 | DURANT | François | chef | 45 | 1891 | Toul | française | journalier\n"
                     "12 | id | Jeanne | épouse | 40 | 1896 | Toul | française | ménagère\n12 | id | Jean Marie | fils | 6 | 1930 | Toul | française |\n"
                     "12 | id | Louise | fille | 3 | 1933 | Toul | française |\n12 | SCHMIDT | Anna | domestique | 19 | 1917 | Metz | française | domestique",
    "document_type": "census", "language": "fr", "date": "1936", "date_iso": "1936", "place": "Toul, Meurthe-et-Moselle",
    "persons": [],
    "households": [{"address": "12 rue de la Gare", "number": "57", "members": [
        {"given_names": "François", "surname": "DURANT", "relation_to_head": "chef", "sex": "M", "age": 45, "birth_year": 1891,
         "birth_place": "Toul", "nationality": "française", "occupation": "journalier", "confidence": "high"},
        {"given_names": "Jeanne", "surname": "id", "relation_to_head": "épouse", "age": 40, "birth_year": 1896, "birth_place": "Toul",
         "occupation": "ménagère", "confidence": "high"},
        {"given_names": "Jean Marie", "surname": "id", "relation_to_head": "fils", "age": 6, "birth_year": 1930, "birth_place": "Toul",
         "confidence": "high"},
        {"given_names": "Louise", "surname": "id", "relation_to_head": "fille", "age": 3, "birth_year": 1933, "birth_place": "Toul",
         "confidence": "medium"},
        {"given_names": "Anna", "surname": "SCHMIDT", "relation_to_head": "domestique", "age": 19, "birth_year": 1917,
         "birth_place": "Metz", "occupation": "domestique", "confidence": "medium"},
    ]}],
    "military": None, "entries": [], "relations": [], "uncertain_passages": [], "translation_fr": None,
}


@pytest.fixture
def fake_ai(monkeypatch):
    """IA simulée (aucun accès réseau) : renvoie la réponse JSON préparée et mémorise les appels."""
    state = {"answer": {}, "calls": []}

    def complete(self, system, user, **kw):
        state["calls"].append({"system": system, "user": user, **kw})
        return AIResponse(json.dumps(state["answer"], ensure_ascii=False), "gemini", "gemini-test")

    monkeypatch.setattr(AIClient, "available", lambda self: True)
    monkeypatch.setattr(AIClient, "complete", complete)
    monkeypatch.setattr(providers.httpx, "post", lambda *a, **k: (_ for _ in ()).throw(AssertionError("réseau interdit")))
    return state


def _png(tmp_path, name="acte.png", color="white"):
    from PIL import Image

    p = tmp_path / name
    Image.new("RGB", (120, 80), color).save(p)
    return p


def _analyze(db, media, answer, fake_ai):
    """Équivaut à POST /analyze-now : lecture en un appel, analyse stockée."""
    from genealis.ai.documents import analyze_media

    fake_ai["answer"] = answer
    cfg.set_value(db, "ai_provider", "gemini")
    res = analyze_media(db, media)
    media.analysis = res.to_dict()
    media.ocr_text = res.transcription
    media.analysis_status = "done"
    db.flush()
    return res


def _default_ids(props):
    return [a["id"] for a in props["actions"] if a["checked"]]


def test_lecture_en_un_appel_et_extraction_stockee(client, fake_ai, tmp_path):
    from genealis.db import session_scope

    with session_scope() as db:
        f = build_fictional_family(db)
        gf_id = f["gf"].id
    cfg_answer = marriage_json()
    fake_ai["answer"] = cfg_answer
    with session_scope() as db:
        cfg.set_value(db, "ai_provider", "gemini")
    up = client.post("/api/media", files={"file": ("mariage.png", _png(tmp_path).read_bytes(), "image/png")},
                     data={"person_id": gf_id, "kind": "document"})
    assert up.status_code == 201, up.text
    mid = up.json()["id"]
    r = client.post(f"/api/media/{mid}/analyze-now", json={"kind": "marriage"})
    assert r.status_code == 200, r.text
    m = r.json()
    assert len(fake_ai["calls"]) == 1  # transcription + extraction en UN seul appel
    call = fake_ai["calls"][0]
    assert call["json_mode"] is True and call["attachments"][0][1] == "image/png"
    assert "paléographe" in call["system"] and "households" in call["system"] and "Acte de mariage" in call["user"]
    ex = m["analysis"]["extraction"]
    assert m["analysis_status"] == "done" and m["analysis"]["method"].startswith("ai:gemini")
    assert ex["document_type"] == "marriage" and ex["date_normalized"]["start"] == "1956-04-12"
    assert ex["persons"][0]["birth_date_normalized"]["start"] == "1929-03-14"
    assert "Mangin" in m["analysis"]["uncertain"] and "DURANT" in m["ocr_text"]
    assert m["analysis"]["requested_kind"] == "marriage"
    # Propositions via l'API, stockées dans l'analyse
    p = client.get(f"/api/media/{mid}/proposals").json()
    assert p["document_type"] == "marriage" and p["people"][0]["person_id"] == gf_id
    with session_scope() as db:
        assert db.get(Media, mid).analysis["proposals"]["fingerprint"] == p["fingerprint"]
    assert client.get(f"/api/media/{mid}/proposals").json()["fingerprint"] == p["fingerprint"]  # déterministe
    caps = client.get("/api/interpret/capabilities").json()
    assert caps["ai_available"] is True and any(k["id"] == "census" for k in caps["kinds"])


def test_sans_ia_message_copier_coller(client, tmp_path, monkeypatch):
    monkeypatch.setattr("genealis.api.interpret.tesseract_available", lambda db: None)
    up = client.post("/api/media", files={"file": ("acte.png", _png(tmp_path).read_bytes(), "image/png")}).json()
    r = client.post(f"/api/media/{up['id']}/analyze-now", json={"kind": "census"})
    assert r.status_code == 409 and "copier-coller" in r.json()["detail"] and "Gemini" in r.json()["detail"]
    # Le type choisi est repris dans le texte à coller, qui demande le même schéma
    prompt = client.get(f"/api/media/{up['id']}/prompt").json()["prompt"]
    assert "Table de recensement" in prompt and "households" in prompt and "relation_to_head" in prompt and "===JSON===" in prompt


def test_propositions_mariage(db, fake_ai, tmp_path):
    f = build_fictional_family(db)
    m = import_file(db, _png(tmp_path), title="Mariage Durant-Kowalska")
    _analyze(db, m, marriage_json(), fake_ai)
    props = get_proposals(db, m)
    people = {p["index"]: p for p in props["people"]}
    acts = {a["id"]: a for a in props["actions"]}
    # Le marié et la mariée existent : correspondance explicable
    assert people[0]["resolution"] == "match" and people[0]["person_id"] == f["gf"].id
    assert people[0]["matches"][0]["level"] == "green" and people[0]["matches"][0]["criteria"]
    assert people[1]["person_id"] == f["gm"].id and "Déjà relié" in people[1]["reason"]
    # Les parents sont nouveaux : fiches proposées et cochées, filiations proposées
    for i in (2, 3, 4, 5):
        assert people[i]["resolution"] == "new" and acts[f"person:{i}"]["kind"] == "create_person" and acts[f"person:{i}"]["checked"]
    assert acts["rel:parent:2:0"]["checked"] and acts["rel:parent:3:0"]["checked"] and acts["rel:parent:4:1"]["checked"]
    # Source primaire au titre explicite
    assert acts["source"]["payload"]["title"] == "Acte de mariage de Jean Marie DURANT et Marie KOWALSKA, Nancy, 1956"
    assert acts["source"]["payload"]["reliability"] == "primary"
    # Le témoin ressemble à Paul MARTIN (noms + âge seulement) : correspondance faible, jamais cochée
    assert people[6]["resolution"] == "weak" and people[6]["person_id"] == f["late_child"].id
    assert not acts["person:6"]["checked"]
    # Mariage de 1955 dans l'arbre, 1956 dans l'acte : contradiction à vérifier, pas un écrasement
    assert acts["event:main"]["mode"] == "conflict" and acts["event:main"]["group"] == "verify"
    assert "Contradiction à vérifier" in acts["event:main"]["label"]
    assert acts["variant:1"]["payload"]["variant"] == "KOWALSKA"
    assert props == get_proposals(db, m)  # mêmes propositions pour la même analyse


def test_application_mariage(db, fake_ai, tmp_path):
    f = build_fictional_family(db)
    gf, gm = f["gf"], f["gm"]
    m = import_file(db, _png(tmp_path), title="Mariage Durant-Kowalska")
    _analyze(db, m, marriage_json(), fake_ai)
    props = get_proposals(db, m)
    summary = apply_proposals(db, m, _default_ids(props), {})
    names = sorted(p["name"] for p in summary["created_persons"])
    assert names == ["François DURANT", "Jeanne PETIT", "Stanislas KOWALSKI", "Zofia NOWAK"]
    fathers = {p.display_name() for p, _ in parents_of(db, gf.id)}
    assert fathers == {"François DURANT", "Jeanne PETIT"}
    assert {p.display_name() for p, _ in parents_of(db, gm.id)} == {"Stanislas KOWALSKI", "Zofia NOWAK"}
    # Les parents du marié forment un couple
    fr = next(p for p, _ in parents_of(db, gf.id) if p.given_names == "François")
    assert any(s.given_names == "Jeanne" for s in spouses_of(db, fr.id))
    # Source + citations
    src = db.execute(select(Source).where(Source.title.like("Acte de mariage de Jean Marie DURANT%"))).scalars().one()
    assert src.reliability == "primary" and src.content_hash == m.sha256 and m.source_id == src.id and "DURANT" in src.transcription
    cits = db.execute(select(Citation).where(Citation.source_id == src.id)).scalars().all()
    assert {c.target_type for c in cits} >= {"person", "parent_child", "event"}
    # La date de naissance vague de l'arbre (« vers 1930 ») est précisée par l'acte et sourcée
    birth = next(e for e in gf.events if e.event_type == "birth")
    db.refresh(birth)
    assert birth.date_start == "1929-03-14" and any(c.target_id == birth.id for c in cits)
    # Le père est dit « feu » : décès avant le mariage
    death = next(e for e in fr.events if e.event_type == "death")
    assert death.date_kind == "before" and death.date_start == "1956-04-12"
    # Contradiction : le mariage de 1955 n'est PAS modifié ; question + hypothèse créées
    fam = db.execute(select(Family).where(Family.partner1_id == gf.id, Family.partner2_id == gm.id)).scalars().one()
    mar = [e for e in fam.events if e.event_type == "marriage"]
    assert len(mar) == 1 and mar[0].sort_year == 1955
    qs = db.execute(select(Question)).scalars().all()
    assert any(q.title.startswith("Contradiction à vérifier") and "1956" in q.title for q in qs)
    assert db.execute(select(Hypothesis).where(Hypothesis.kind == "event")).scalars().first() is not None
    # Le témoin (correspondance faible, non tranchée) devient une question, sans aucun lien créé
    assert any("Paul MARTIN" in q.title and "est-il" in q.title for q in qs)
    assert summary["questions"] and m.person_id == gf.id
    assert "KOWALSKA" in (db.get(Person, gm.id).name_variants or [])
    # Journal des décisions
    from genealis.models import ResearchLog

    logs = db.execute(select(ResearchLog).where(ResearchLog.category == "decision")).scalars().all()
    assert any("création de la fiche François DURANT" in l.message for l in logs)
    # Propositions recalculées : les parents sont maintenant reconnus
    again = get_proposals(db, m)
    assert {p["index"]: p for p in again["people"]}[2]["resolution"] == "match"


def test_mariage_sans_contradiction_participants(db, fake_ai, tmp_path):
    """Mariage déjà connu à la même date : complété (source + participants), jamais dupliqué."""
    f = build_fictional_family(db)
    ans = marriage_json(date_iso="1988-06-15", written="quinze juin mil neuf cent quatre-vingt-huit",
                        groom=("Pierre", "DURANT", "3 février 1960", "Nancy", 28), bride=("Anna", "ROSSI", "1962", "Lunéville", 26), parents=False)
    m = import_file(db, _png(tmp_path, "m2.png", "gray"), title="Mariage Durant-Rossi")
    _analyze(db, m, ans, fake_ai)
    props = get_proposals(db, m)
    acts = {a["id"]: a for a in props["actions"]}
    assert acts["event:main"]["mode"] == "complete" and acts["event:main"]["checked"]
    apply_proposals(db, m, _default_ids(props), {})
    fam = db.execute(select(Family).where(Family.partner1_id == f["father"].id)).scalars().one()
    mar = [e for e in fam.events if e.event_type == "marriage"]
    assert len(mar) == 1
    attrs = mar[0].attributes
    assert attrs["media_id"] == m.id and attrs["act_number"] == "212" and attrs["officer"].startswith("Louis")
    roles = {p["role"]: p for p in attrs["participants"]}
    assert roles["witness"]["name"] == "Paul MARTIN" and roles["witness"]["age"] == 26 and roles["witness"]["occupation"] == "employé"
    assert roles["subject"]["person_id"] == f["father"].id and "DURANT" in attrs["transcription"]
    assert db.execute(select(Citation).where(Citation.target_type == "event", Citation.target_id == mar[0].id)).scalars().first()


def test_choix_utilisateur_et_atomicite(db, fake_ai, tmp_path):
    f = build_fictional_family(db)
    m = import_file(db, _png(tmp_path), title="Mariage")
    _analyze(db, m, marriage_json(), fake_ai)
    props = get_proposals(db, m)
    # L'utilisateur confirme que le témoin est bien Paul MARTIN (personne choisie) et refuse de créer Zofia
    ids = [i for i in _default_ids(props) if i != "person:5"]
    summary = apply_proposals(db, m, ids, {"6": f["late_child"].id})
    assert any(p["id"] == f["late_child"].id for p in summary["linked_persons"])
    assert not db.execute(select(Person).where(Person.given_names == "Zofia")).scalars().first()
    assert any(s["id"] == "rel:parent:5:1" for s in summary["skipped"])
    # Personne choisie inexistante : erreur claire, rien n'est écrit par l'API
    from genealis.services.interpret import ApplyError

    m2 = import_file(db, _png(tmp_path, "b.png", "black"), title="Autre")
    _analyze(db, m2, marriage_json(), fake_ai)
    with pytest.raises(ApplyError):
        apply_proposals(db, m2, _default_ids(get_proposals(db, m2)), {"0": "inexistant"})


def test_recensement_menage(db, fake_ai, tmp_path):
    f = build_fictional_family(db)
    gf = f["gf"]
    m = import_file(db, _png(tmp_path, "recensement.png", "beige"), title="Recensement Toul 1936")
    _analyze(db, m, CENSUS, fake_ai)
    props = get_proposals(db, m)
    people = {p["index"]: p for p in props["people"]}
    acts = {a["id"]: a for a in props["actions"]}
    assert [p["role"] for p in props["people"]][:1] == ["head_of_household"]
    assert people[1]["married_name"] == "DURANT" and people[1]["surname"] is None
    assert people[2]["resolution"] == "match" and people[2]["person_id"] == gf.id  # le fils est Jean Marie DURANT
    assert people[0]["resolution"] == "new" and acts["person:0"]["checked"]
    assert acts["rel:parent:0:2"]["checked"] and acts["rel:parent:0:3"]["checked"]
    assert acts["rel:union:0:1"]["checked"]
    assert not acts["rel:parent:1:3"]["checked"]  # seconde filiation probable : proposée, non cochée
    assert not acts["person:4"]["checked"]  # la domestique n'est pas de la famille
    assert props["source_title"] == "Recensement de population — ménage de François DURANT, Toul, 1936"
    summary = apply_proposals(db, m, _default_ids(props), {})
    head = db.execute(select(Person).where(Person.given_names == "François", Person.surname == "DURANT")).scalars().one()
    louise = db.execute(select(Person).where(Person.given_names == "Louise", Person.surname == "DURANT")).scalars().one()
    assert louise.surname == "DURANT" and louise.sex == "F"
    assert head.id in {p.id for p, _ in parents_of(db, louise.id)}
    assert head.id in {p.id for p, _ in parents_of(db, gf.id)}
    jeanne = db.execute(select(Person).where(Person.given_names == "Jeanne")).scalars().one()
    assert jeanne.married_name == "DURANT" and jeanne.surname is None and jeanne.id in {s.id for s in spouses_of(db, head.id)}
    assert not db.execute(select(Person).where(Person.surname == "SCHMIDT")).scalars().first()
    assert head.occupation == "journalier"
    for pid in (head.id, louise.id, gf.id, jeanne.id):
        res = db.execute(select(Event).where(Event.person_id == pid, Event.event_type == "residence")).scalars().all()
        assert len(res) == 1 and res[0].sort_year == 1936 and "12 rue de la Gare" in res[0].description
        assert len(res[0].attributes["participants"]) == 5 and res[0].attributes["media_id"] == m.id
    assert summary["sources"][0]["reliability"] == "primary"
    # Naissance d'après l'année déclarée
    lb = db.execute(select(Event).where(Event.person_id == louise.id, Event.event_type == "birth")).scalars().one()
    assert lb.sort_year == 1933


def test_copier_coller_meme_schema(db, tmp_path):
    m = import_file(db, _png(tmp_path, "c.png", "blue"), title="Recensement")
    m.analysis = {"requested_kind": "census"}
    prompt = manual_prompt(m)
    assert "households" in prompt and "Table de recensement" in prompt and "military" in prompt
    tr = CENSUS["transcription"]
    ex = {k: v for k, v in CENSUS.items() if k != "transcription"}
    res = parse_manual_answer(f"TRANSCRIPTION :\n{tr}\n===JSON===\n```json\n{json.dumps(ex, ensure_ascii=False)}\n```")
    assert res.extraction["document_type"] == "census" and len(res.extraction["households"][0]["members"]) == 5
    assert res.extraction["households"][0]["members"][0]["age"] == 45
    # Réponse JSON seule (transcription incluse)
    res2 = parse_manual_answer(json.dumps(CENSUS, ensure_ascii=False))
    assert res2.transcription.startswith("Toul") and res2.extraction["households"]


def test_outils_dates_et_liens():
    assert kin_of("sa fille") == "child" and kin_of("épouse") == "spouse" and kin_of("domestique") is None
    assert kin_of("chef de ménage") == "head" and kin_of("belle-mère") is None and kin_of("frère") == "sibling"
    e = Event(event_type="birth", date_kind="approx", date_start="1930", sort_year=1930)
    assert dates_compatible(e, parse_gendate("14 mars 1929"))
    e2 = Event(event_type="marriage", date_kind="exact", date_start="1955", sort_year=1955)
    assert not dates_compatible(e2, parse_gendate("1956-04-12"))
    e3 = Event(event_type="marriage", date_kind="exact", date_start="1955-06-02", sort_year=1955)
    assert not dates_compatible(e3, parse_gendate("1955-06-03")) and dates_compatible(e3, parse_gendate("1955"))

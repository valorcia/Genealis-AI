"""Livre de famille : ordre des chapitres, biographies factuelles accordées en genre, annexes, faits manquants.

Aucun accès réseau : les appels Wikipédia/Wikidata sont remplacés par des faux."""
import re

import pytest

from genealis.data.trades import TRADES, lookup_trade, split_occupations
from genealis.models import Event, Media, Person, Place, Setting, Source
from genealis.schemas import EventIn, PersonIn, RelationIn
from genealis.services import book, wiki
from genealis.services.persons import add_event, add_relation, create_person
from genealis.tests.fixtures import build_fictional_family


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    """Par défaut : réseau coupé (comme un poste hors ligne)."""
    calls = {"n": 0}

    def boom(*a, **k):
        calls["n"] += 1
        raise wiki._NetworkError("hors ligne (test)")

    monkeypatch.setattr(wiki, "fetch_summary", boom)
    monkeypatch.setattr(wiki, "fetch_claims", boom)
    return calls


def _paragraphs(ch: dict) -> list[str]:
    return [b["text"] for b in ch["blocks"] if b["type"] == "paragraph"]


def _text(ch: dict) -> str:
    return "\n".join(_paragraphs(ch))


def test_sommaire_ordonne_par_sosa(db):
    f = build_fictional_family(db)
    o = book.outline(db)
    chapters = o["chapters"]
    assert [c["sosa"][0] for c in chapters[:6]] == [1, 2, 3, 4, 5, 6]
    assert chapters[0]["person_id"] == f["me"].id and chapters[3]["person_id"] == f["gf"].id
    assert chapters[3]["generation"] == 3 and chapters[3]["years"] == "1930 – 1998"
    # Les personnes hors ascendance viennent après, sans numéro Sosa
    assert all(not c["sosa"] for c in chapters[6:]) and len(chapters) == 10
    assert o["title"] == "Livre de la famille DURANT · ROSSI"
    assert o["counts"]["ancestors"] == 6 and o["counts"]["generations"] == 3
    assert o["annexes"]["trades"] >= 2


def test_biographie_accord_en_genre(db):
    f = build_fictional_family(db)
    gf = _text(book.chapter(db, f["gf"]))
    assert "Je suis né vers 1930 à Toul." in gf
    assert "Je suis mort en 1998 à Nancy" in gf
    assert "j'ai épousé Marie KOWALSKI" in gf and "elle environ 23 ans" in gf
    assert "Les documents me disent cheminot." in gf
    assert "numéro Sosa 4" in gf and "2e génération" in gf and "la lignée continue par mon fils Pierre DURANT" in gf
    gm = _text(book.chapter(db, f["gm"]))
    assert "Je suis née en 1932 à Varsovie." in gm and "Je suis morte en 2005 à Nancy" in gm
    assert "une ancêtre" in gm and "Les documents le disent cheminot." in gm
    me = _text(book.chapter(db, f["me"]))
    assert "Je suis née le 12 mai 1990 à Nancy." in me
    assert "Mon père était Pierre DURANT, ingénieur, qui avait 30 ans à ma naissance" in me
    assert "Marc LEFÈVRE est mon beau-père" in me
    assert "Je suis morte" not in me  # personne vivante : rien sur un décès
    mgf = _text(book.chapter(db, f["mgf"]))
    assert "En 1950, je suis arrivé à Nancy." in mgf
    assert "la lignée continue par ma fille Anna ROSSI" in mgf


def test_aucun_fait_invente(db):
    """Chaque nom propre et chaque année cités dans les paragraphes figurent dans la base."""
    f = build_fictional_family(db)
    allowed_words = set()
    for p in db.query(Person).all():
        for part in (p.given_names, p.surname, p.married_name, p.display_name()):
            allowed_words.update(re.findall(r"[\wÀ-ÿ'-]+", part or ""))
    for pl in db.query(Place).all():
        allowed_words.update(re.findall(r"[\wÀ-ÿ'-]+", pl.name or ""))
    grammar = {"Je", "Mon", "Ma", "Mes", "Dans", "Les", "Le", "La", "En", "Ensemble", "Sosa", "Il", "Elle", "Un", "Une",
               "Nos", "Notre", "Étaient", "J'ai", "L'acte", "De", "Mon", "Ma", "Nous", "Pour"}
    years = {e.sort_year for e in db.query(Event).all() if e.sort_year}
    for key in ("me", "father", "mother", "gf", "gm", "mgf", "late_child", "ghost_mother", "homonym", "step"):
        ch = book.chapter(db, f[key])
        for para in _paragraphs(ch):
            for word in re.findall(r"\b[A-ZÀ-Ý][\wÀ-ÿ'-]*", para):
                assert word in allowed_words or word in grammar, f"« {word} » n'est pas dans la base : {para}"
            for y in re.findall(r"\b(1[5-9]\d\d|20\d\d)\b", para):
                assert int(y) in years, f"année {y} absente de la base : {para}"
        # Paragraphes justifiés : les sources sont celles de la base
        src_ids = {s.id for s in db.query(Source).all()}
        for b in ch["blocks"]:
            for s in b.get("sources", []):
                assert s["source_id"] in src_ids
    # La filiation de Pierre est sourcée : le paragraphe de naissance cite l'acte
    pierre = book.chapter(db, f["father"])
    first = next(b for b in pierre["blocks"] if b.get("kind") == "birth")
    assert any("Acte de naissance de Pierre Durant" in (s["title"] or "") for s in first["sources"])


def test_participants_actes_et_gens_autour(db):
    p = create_person(db, PersonIn(given_names="Charles", surname="Pierrel", sex="M", occupation="tisserand"))
    father = create_person(db, PersonIn(given_names="Christophe", surname="Pierrel", sex="M", birth_date="1825"))
    add_relation(db, RelationIn(parent_id=father.id, child_id=p.id))
    img = Media(path="/tmp/acte.jpg", mime_type="image/jpeg", kind="document", title="Acte de naissance PIERREL Charles", person_id=p.id)
    db.add(img)
    db.flush()
    add_event(db, p.id, EventIn(event_type="birth", date="15/11/1856", place="Domèvre-sur-Vezouze", attributes={
        "participants": [{"name": "Christophe PIERREL", "role": "declarant", "age": "31", "occupation": "manœuvre", "relation": "son père"},
                         {"name": "Jean-Baptiste SIMON", "role": "witness", "age": "60", "occupation": "greffier de mairie"}],
        "officer": "Jean-Baptiste COLIN, maire", "act_number": "11", "media_id": img.id,
        "transcription": "N° 11. PIERREL Charles, né le 15 novembre 1856…"}))
    add_event(db, p.id, EventIn(event_type="death", date="22/06/1898", place="Moyen", attributes={
        "participants": [{"name": "Charles CONTE", "role": "declarant", "age": "35", "occupation": "cantonnier", "relation": "beau-frère"}],
        "officer": "Henri RENARD, maire"}))
    add_event(db, p.id, EventIn(event_type="census", date="1872", place="Ancerviller"))
    add_event(db, p.id, EventIn(event_type="occupation", date="1887", value_original="journalier"))
    ch = book.chapter(db, p)
    t = _text(ch)
    assert "Je suis né le 15 novembre 1856 à Domèvre-sur-Vezouze." in t
    assert "Mon père était Christophe PIERREL, qui avait environ 31 ans à ma naissance." in t
    assert ("Ma naissance a été déclarée devant Jean-Baptiste COLIN, maire, par Christophe PIERREL "
            "(31 ans, manœuvre, son père), en présence de Jean-Baptiste SIMON (60 ans, greffier de mairie).") in t
    assert "En 1872, j'ai été recensé à Ancerviller." in t
    assert "Les documents me disent journalier (1887) et tisserand." in t
    assert "Je suis mort le 22 juin 1898 à Moyen, à l'âge de 41 ans." in t
    assert "Mon décès a été déclaré à Henri RENARD, maire, par Charles CONTE (35 ans, cantonnier, beau-frère)." in t
    # Encadré métier : définition du dictionnaire, étiquetée
    metier = [b for b in ch["blocks"] if b["type"] == "box" and b["kind"] == "metier"]
    assert metier and metier[0]["title"] in ("Journalier", "Tisserand") and "dictionnaire" in metier[0]["origin"]
    # Les gens autour de moi / actes / lieux
    around = {x["event_type"]: x for x in ch["people_around"]}
    assert around["birth"]["officer"] == "Jean-Baptiste COLIN, maire" and len(around["birth"]["participants"]) == 2
    act = next(a for a in ch["acts"] if a["event_type"] == "birth")
    assert act["image_url"] == f"/api/media/{img.id}/file" and act["act_number"] == "11" and act["transcription"].startswith("N° 11")
    assert [x["name"] for x in ch["places"]] == ["Domèvre-sur-Vezouze", "Ancerviller", "Moyen"]
    assert any(d["kind"] == "media" and d["id"] == img.id for d in ch["documents"])


def test_age_au_deces_et_etiquettes_contexte(db):
    p = create_person(db, PersonIn(given_names="Charles", surname="Pierrel", sex="M", birth_date="15/11/1856",
                                   birth_place="Lunéville", death_date="22/06/1898", death_place="Lunéville"))
    ch = book.chapter(db, p)
    t = _text(ch)
    assert "Je suis mort le 22 juin 1898 à Lunéville, à l'âge de 41 ans." in t
    ep = next(b for b in ch["blocks"] if b["type"] == "box" and b["kind"] == "epoque")
    assert 1 <= len(ep["items"]) <= 3 and all(1856 <= i["end"] and i["start"] <= 1898 for i in ep["items"])
    assert any("Guerre franco-prussienne" == i["label"] and "environ 14 ans" in i["age_line"] for i in ep["items"])
    q = next(b for b in ch["blocks"] if b["type"] == "box" and b["kind"] == "quotidien")
    assert "Repère général" in q["origin"] and q["title"] == "La Lorraine coupée en deux"


def test_contexte_wikipedia_mis_en_cache(db, monkeypatch):
    calls = {"summary": 0, "claims": 0}

    def fake_summary(title, timeout=4.0):
        calls["summary"] += 1
        if title == "Lunéville":
            return {"type": "standard", "title": "Lunéville", "description": "commune française de Meurthe-et-Moselle",
                    "extract": "Lunéville est une commune française située dans le département de Meurthe-et-Moselle.",
                    "content_urls": {"desktop": {"page": "https://fr.wikipedia.org/wiki/Lun%C3%A9ville"}},
                    "thumbnail": {"source": "https://upload.wikimedia.org/x.jpg"}, "wikibase_item": "Q123"}
        return None

    def fake_claims(qid, timeout=4.0):
        calls["claims"] += 1
        return {"claims": {"P94": [{"mainsnak": {"datavalue": {"value": "Blason Lunéville.svg"}}}]}}

    monkeypatch.setattr(wiki, "fetch_summary", fake_summary)
    monkeypatch.setattr(wiki, "fetch_claims", fake_claims)
    p = create_person(db, PersonIn(given_names="Anne", surname="Colin", sex="F", birth_date="1900", birth_place="Lunéville"))
    ch = book.chapter(db, p)
    village = next(b for b in ch["blocks"] if b["type"] == "box" and b["kind"] == "village")
    assert village["title"] == "Lunéville" and "commune française" in village["text"]
    assert village["url"].startswith("https://fr.wikipedia.org/") and "Wikipédia" in village["origin"]
    assert village["coat_of_arms"].startswith("https://commons.wikimedia.org/wiki/Special:FilePath/Blason_Lun")
    n = calls["summary"]
    book.chapter(db, p)
    assert calls["summary"] == n  # deuxième lecture servie par le cache (table settings)
    assert db.query(Setting).filter(Setting.key.like("cache:wiki:place:%")).count() == 1


def test_hors_ligne_degrade_proprement(db, offline):
    p = create_person(db, PersonIn(given_names="Anne", surname="Colin", sex="F", birth_date="1900", birth_place="Nancy"))
    ch = book.chapter(db, p)
    assert not [b for b in ch["blocks"] if b["type"] == "box" and b["kind"] == "village"]
    assert ch["wiki_offline"] is True and offline["n"] == 1  # un seul essai réseau par page


def test_dictionnaire_des_metiers():
    assert len(TRADES) >= 80
    for t in TRADES:
        assert t["definition"] and len(t["description"]) > 60
    assert lookup_trade("Manouvrière")["key"] == "manouvrier"
    assert lookup_trade("Manœuvre")["key"] == "manoeuvre"
    assert lookup_trade("tisserand en coton")["key"] == "tisserand"
    assert lookup_trade("institutrice")["key"] == "instituteur"
    assert lookup_trade("Maréchal ferrant")["key"] == "marechal-ferrant"
    assert lookup_trade("cristallier à Baccarat")["key"] == "cristallier"
    assert lookup_trade("astronaute") is None
    assert split_occupations("tisserand et journalier, manœuvre") == ["tisserand", "journalier", "manœuvre"]


def test_annexes_metiers_et_villages(db):
    f = build_fictional_family(db)
    trades = book.trades_annex(db, with_wiki=False)
    chem = next(t for t in trades if t["label"] == "Cheminot")
    assert chem["in_dictionary"] and chem["family_line"] == "Dans la famille : Jean Marie DURANT (1930 – 1998)."
    places = book.places_annex(db, with_wiki=False)
    toul = next(p for p in places if p["name"] == "Toul")
    assert toul["ancestors_line"] == "Ancêtres : Jean Marie DURANT (naissance 1930)."
    nancy = next(p for p in places if p["name"] == "Nancy")
    assert any(a["detail"] == "mariage 1955 · décès 1998" for a in nancy["ancestors"])
    assert all(t["start"] <= nancy["year_end"] + 10 for t in nancy["timeline"])


def test_dates_et_actes_a_trouver(db):
    f = build_fictional_family(db)
    todo = book.todo_lists(db)
    dates = {r["person_id"]: [i["label"] for i in r["items"]] for r in todo["dates"]}
    acts = {r["person_id"]: [i["label"] for i in r["items"]] for r in todo["acts"]}
    assert any("Date de naissance exacte à préciser" in x for x in dates[f["gf"].id])
    assert any("Date de décès exacte à préciser" in x for x in dates[f["gf"].id])
    assert "Acte de décès à retrouver" in acts[f["gf"].id]
    assert not any("décès" in x for x in acts.get(f["me"].id, []))  # personne vivante
    assert "Acte de mariage avec Anna ROSSI à retrouver" in acts[f["father"].id]
    # Classement : ancêtres d'abord, par numéro Sosa
    sosas = [r["sosa"][0] for r in todo["acts"] if r["sosa"]]
    assert sosas == sorted(sosas) and todo["acts"][0]["sosa"] == [1]
    # Chapitre : « Recherches en cours » reprend ces manques
    ch = book.chapter(db, f["gf"])
    assert any(r["kind"] == "missing" and r["title"] == "Acte de décès à retrouver" for r in ch["research"])


def test_api_livre(client, monkeypatch):
    from genealis.db import session_scope

    with session_scope() as s:
        f = build_fictional_family(s)
        gf_id = f["gf"].id
    o = client.get("/api/book/outline").json()
    assert o["chapters"][3]["person_id"] == gf_id
    ch = client.get(f"/api/book/person/{gf_id}").json()
    assert ch["sosa"] == [4] and any(b["kind"] == "sosa" for b in ch["blocks"])
    assert client.get("/api/book/person/inconnu").status_code == 404
    assert client.get("/api/book/todo").json()["counts"]["acts"] > 0
    assert any(t["label"] == "Cheminot" for t in client.get("/api/book/annexes/trades").json())
    assert any(p["name"] == "Toul" for p in client.get("/api/book/annexes/places").json())
    r = client.post(f"/api/book/person/{gf_id}/rewrite")
    assert r.status_code == 400 and "IA" in r.json()["detail"]


def test_reecriture_ia_a_partir_des_faits(db, monkeypatch):
    from genealis.ai import providers

    f = build_fictional_family(db)
    seen = {}

    def fake_complete(self, system, user, **kw):
        seen["system"], seen["user"] = system, user
        return providers.AIResponse(text="Je suis né vers 1930 à Toul, et je fus cheminot.", provider="test", model="fake")

    monkeypatch.setattr(providers.AIClient, "available", lambda self: True)
    monkeypatch.setattr(providers.AIClient, "complete", fake_complete)
    out = book.rewrite(db, f["gf"])
    facts = _paragraphs(book.chapter(db, f["gf"], with_wiki=False))
    assert seen["user"].endswith("\n\n".join(facts))  # uniquement les faits
    assert "N'ajoute AUCUN fait" in seen["system"]
    assert out["label"] == "Texte reformulé par l'IA à partir des faits ci-dessous"
    ch = book.chapter(db, f["gf"])
    assert ch["ai_story"]["text"].startswith("Je suis né") and ch["ai_story"]["stale"] is False
    assert _paragraphs(ch) == facts  # le texte factuel reste le texte par défaut
    assert book.delete_rewrite(db, f["gf"].id) and book.chapter(db, f["gf"])["ai_story"] is None

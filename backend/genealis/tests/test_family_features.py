"""Ajout rapide de proches, âge, liens de parenté, statistiques, démarrage par les grands-parents, sous-arbres, archivage web."""
import httpx
import pytest

from genealis.models import Media, ParentChild, Person, SiblingLink
from genealis.schemas import PersonIn, RelativeIn
from genealis.services.kinship import kinship
from genealis.services.persons import add_relative, create_person, parents_of, person_summary, siblings_of
from genealis.services.stats import compute, database_state
from genealis.tests.fixtures import build_fictional_family


def test_age_exact_et_approximatif(db):
    p = create_person(db, PersonIn(given_names="Robert", surname="Christina", birth_date="24/03/1932", death_date="05/09/2014"))
    s = person_summary(db, p)
    assert s.age_years == 82 and s.age_detail == "82 a 5 m 12 j" and s.age_context == "au décès"
    q = create_person(db, PersonIn(given_names="Rosa", surname="Moia", birth_date="1908", death_date="1979"))
    assert person_summary(db, q).age_display == "≈ 71 ans"
    old = create_person(db, PersonIn(given_names="X", surname="Ancien", birth_date="1700"))
    assert person_summary(db, old).age_years is None  # décédé sans date : aucun âge inventé


def test_ajout_rapide_de_proches(db):
    me = create_person(db, PersonIn(given_names="Charles", surname="Christina", sex="M", birth_date="1935"))
    father = add_relative(db, me, RelativeIn(relation="father", person=PersonIn(given_names="Louis", surname="Christina")))["person"]
    mother = add_relative(db, me, RelativeIn(relation="mother", person=PersonIn(given_names="Rosa", surname="Moia")))["person"]
    assert father.sex == "M" and mother.sex == "F"
    assert {p.id for p, _ in parents_of(db, me.id)} == {father.id, mother.id}
    # Frère : rattaché automatiquement aux deux parents
    bro = add_relative(db, me, RelativeIn(relation="brother", person=PersonIn(given_names="Robert", surname="Christina")))["person"]
    assert {p.id for p, _ in parents_of(db, bro.id)} == {father.id, mother.id}
    assert bro.id in {s.id for s in siblings_of(db, me.id)}
    # Deuxième père biologique refusé
    with pytest.raises(ValueError):
        add_relative(db, me, RelativeIn(relation="father", person=PersonIn(given_names="Autre")))
    # Grand-père paternel
    gp = add_relative(db, me, RelativeIn(relation="paternal_grandfather", person=PersonIn(given_names="Giovanni", surname="Christina")))
    assert gp["placeholders"] == [] and gp["person"].id in {p.id for p, _ in parents_of(db, father.id)}
    # Grand-mère maternelle d'une personne sans mère : fiche d'attente explicite
    solo = create_person(db, PersonIn(given_names="Solo"))
    res = add_relative(db, solo, RelativeIn(relation="maternal_grandmother", person=PersonIn(given_names="Anna")))
    assert len(res["placeholders"]) == 1 and "rechercher" in db.get(Person, res["placeholders"][0]).notes
    # Sœur sans parents connus : lien de fratrie, aucun parent inventé
    sis = add_relative(db, solo, RelativeIn(relation="sister", person=PersonIn(given_names="Lina")))["person"]
    assert db.query(SiblingLink).count() == 0 or sis.id in {s.id for s in siblings_of(db, solo.id)}
    # Enfant avec conjoint
    wife = add_relative(db, me, RelativeIn(relation="wife", person=PersonIn(given_names="Maria"), marriage_date="1960"))["person"]
    kid = add_relative(db, me, RelativeIn(relation="daughter", person=PersonIn(given_names="Anne"), other_parent_id=wife.id))["person"]
    assert {p.id for p, _ in parents_of(db, kid.id)} == {me.id, wife.id}


def test_liens_de_parente(db):
    f = build_fictional_family(db)
    assert kinship(db, f["me"].id, f["gf"].id)["relation"] == "grand-père"
    assert kinship(db, f["gf"].id, f["me"].id)["relation"] == "petite-fille"
    me = f["me"]
    cousin_parent = add_relative(db, f["father"], RelativeIn(relation="sister", person=PersonIn(given_names="Tata", surname="Durant")))["person"]
    assert kinship(db, me.id, cousin_parent.id)["relation"] == "tante"
    cousin = add_relative(db, cousin_parent, RelativeIn(relation="son", person=PersonIn(given_names="Léo")))["person"]
    k = kinship(db, me.id, cousin.id)
    assert k["relation"] == "cousin germain" and k["civil_degree"] == 4 and len(k["path"]) == 5
    assert kinship(db, me.id, f["homonym"].id)["found"] is False


def test_statistiques_et_etat(db):
    build_fictional_family(db)
    st = compute(db)
    assert st["persons"] == 10 and st["age_at_death"]["count"] >= 2
    assert any(d["surname"] == "DURANT" for d in st["surname_distribution"])
    state = database_state(db)
    assert state["counts"]["persons"] == 10 and state["missing_parents"]


def test_demarrage_par_les_grands_parents_et_sous_arbres(client):
    r = client.post("/api/quickstart", json={"people": [{"given_names": "Louis", "surname": "Christina", "sex": "M", "birth_date": "08/12/1906",
                                                         "birth_place": "Jœuf", "death_date": "15/10/1979"},
                                                        {"given_names": "Rosa", "surname": "Moia", "sex": "F", "birth_date": "1908",
                                                         "birth_place": "Borgomanero, Italie"}],
                                             "children": [{"given_names": "Robert", "surname": "Christina", "sex": "M", "birth_date": "24/03/1932"}],
                                             "research": True})
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["persons"]) == 2 and len(data["children"]) == 1 and data["family_id"] and data["tasks"]
    root = client.get(f"/api/persons/{data['root_id']}").json()
    assert root["is_root"] and root["age_detail"] == "72 a 10 m 7 j"
    child = client.get(f"/api/persons/{data['children'][0]}").json()
    assert len(child["parents"]) == 2
    # Ajout d'un proche par l'API, recherche lancée
    r = client.post(f"/api/persons/{data['children'][0]}/relatives", json={"relation": "brother", "person": {"given_names": "Charles"}, "research": True})
    assert r.status_code == 201 and r.json()["task_ids"]
    # Export GEDCOM du sous-arbre descendant
    ged = client.get(f"/api/export/gedcom?root_id={data['root_id']}&scope=descendants&hide_living=false").text
    assert "Robert" in ged and "Charles" in ged and "Rosa" not in ged
    # Site internet
    assert client.get("/api/export/site.zip").content[:2] == b"PK"
    # Suppression d'un sous-arbre : aperçu puis confirmation
    prev = client.delete(f"/api/persons/{data['root_id']}/subtree?scope=descendants").json()
    assert prev["would_delete"] == 2
    assert client.delete(f"/api/persons/{data['root_id']}/subtree?scope=descendants&confirm=SUPPRIMER").json()["deleted"] == 2
    assert client.get("/api/stats").json()["persons"] == 2
    assert client.get("/api/events").json()
    assert isinstance(client.get("/api/research/discoveries").json(), list)
    adv = client.post(f"/api/research/advice/{data['root_id']}").json()
    assert adv["source"] == "rules" and adv["links"]


def _transport():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            if request.url.host == "interdit.example":
                return httpx.Response(200, text="User-agent: *\nDisallow: /")
            return httpx.Response(404)
        if request.url.path.endswith(".png"):
            return httpx.Response(200, content=b"\x89PNG\r\n\x1a\nfake", headers={"content-type": "image/png"})
        return httpx.Response(200, text="<html><head><title>Acte de naissance</title><script>alert(1)</script></head>"
                                         "<body onload='x()'><p>Jean Dupont, né à Nancy</p></body></html>",
                              headers={"content-type": "text/html; charset=utf-8"})
    return httpx.MockTransport(handler)


def test_archivage_web(db):
    from genealis.services import storage
    from genealis.services.web_archive import ArchiveRefused, archive_url

    f = build_fictional_family(db)
    medias = archive_url(db, "https://archives.example/acte", person_id=f["father"].id, transport=_transport())
    m = medias[0]
    assert m.kind == "webpage" and m.title == "Acte de naissance" and "Nancy" in m.ocr_text
    html = storage.read_bytes(m.path).decode()
    assert "<script" not in html and "onload" not in html and "Page archivée par GENEALIS" in html and "<base href=" in html
    img = archive_url(db, "https://archives.example/scan.png", person_id=f["father"].id, transport=_transport())[0]
    assert img.kind == "photo" and img.analysis["archived_from"].endswith("scan.png")
    with pytest.raises(ArchiveRefused):
        archive_url(db, "https://interdit.example/page", transport=_transport())
    with pytest.raises(ArchiveRefused):
        archive_url(db, "https://www.geneanet.org/fonds/individus", transport=_transport())


def test_sosa_ignore_les_beaux_parents(db):
    from genealis.services.narrative import person_narrative
    from genealis.services.tree import ancestors_graph

    f = build_fictional_family(db)
    g = ancestors_graph(db, f["me"].id)
    sosa = {n["id"]: n["sosa"] for n in g["nodes"]}
    assert sosa[f["father"].id] == [2] and sosa[f["mother"].id] == [3] and sosa[f["step"].id] == []
    assert sosa[f["mgf"].id] == [6]  # père de la mère
    txt = person_narrative(db, f["me"])["paragraphs"][1]["text"]
    assert "Pierre DURANT et de Anna ROSSI." in txt and "beau-parent" in txt


def test_numeros_sosa_de_la_base(db):
    from genealis.services.sosa import generation_of, sosa_map

    f = build_fictional_family(db)
    m = sosa_map(db)
    assert m[f["me"].id] == [1] and m[f["father"].id] == [2] and m[f["mother"].id] == [3]
    assert m[f["gf"].id] == [4] and m[f["gm"].id] == [5] and m[f["mgf"].id] == [6]
    assert f["step"].id not in m and f["homonym"].id not in m
    assert generation_of(6) == 3
    assert person_summary(db, f["gf"], m).sosa == [4]

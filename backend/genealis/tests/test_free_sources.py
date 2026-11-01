from pathlib import Path

from genealis.connectors import insee_local
from genealis.connectors.base import SearchQuery, registry
from genealis.connectors.free_sources import GallicaConnector
from genealis.connectors import registry_service  # noqa: F401


def test_parse_ligne_insee(tmp_path):
    line = ("DUPONT*JEAN MARIE/".ljust(80) + "1" + "19250312" + "54395" + "NANCY".ljust(30) + "".ljust(30) + "19980704" + "54395" + "000123456")
    rec = insee_local.parse_line(line)
    assert rec["nom"] == "DUPONT" and rec["prenoms"] == "JEAN MARIE" and rec["sexe"] == "M"
    assert rec["naissance"] == "19250312" and rec["commune_naissance"] == "NANCY" and rec["deces"] == "19980704" and rec["acte"] == "000123456"
    f = tmp_path / "deces-1998.txt"
    f.write_text(line + "\n" + line.replace("DUPONT*JEAN MARIE/", "DUPOND*LOUISE/").replace("19250312", "19300101") + "\n", encoding="utf-8")
    assert insee_local.import_file(f) == 2
    hits = insee_local.search_local("Dupont", "Jean", birth_year=1925)
    assert len(hits) == 1 and hits[0]["deces"] == "1998-07-04"
    assert insee_local.status()["records"] == 2


def test_connecteurs_gratuits_enregistres_et_non_operationnels_par_defaut():
    ids = {c.id for c in registry.all()}
    for cid in ("gallica", "openarch", "internet_archive", "geneteka", "nominatim", "wikidata", "insee_deces_local", "grand_memorial", "limedia"):
        assert cid in ids
    assert all(not c.capabilities.requires_credentials for c in registry.all() if c.id in ("gallica", "openarch", "internet_archive", "insee_deces_local"))


def test_gallica_parse_sru():
    xml = """<?xml version="1.0"?><srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/">
    <srw:records><srw:record><srw:recordData><oai_dc:dc><dc:title>Journal de la Meurthe et des Vosges</dc:title><dc:date>1895-03-12</dc:date>
    <dc:identifier>https://gallica.bnf.fr/ark:/12148/bpt6k123</dc:identifier><dc:type>text</dc:type></oai_dc:dc></srw:recordData></srw:record></srw:records></srw:searchRetrieveResponse>"""
    res = GallicaConnector()._parse(xml, SearchQuery(surname="Dupont"))
    assert len(res) == 1 and res[0].year == 1895 and res[0].url.endswith("bpt6k123")

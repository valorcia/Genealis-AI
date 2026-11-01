from genealis.io.gedcom import export_gedcom, import_gedcom
from genealis.models import ParentChild, Person, Source
from genealis.tests.fixtures import build_fictional_family

SAMPLE = """0 HEAD
1 SOUR TEST
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @S1@ SOUR
1 TITL Registre paroissial de Toul (fictif)
1 REFN 5 E 12
0 @I1@ INDI
1 NAME Jean /Dupont/
1 SEX M
1 BIRT
2 DATE ABT 1850
2 PLAC Toul, Meurthe-et-Moselle, France
2 SOUR @S1@
3 PAGE vue 4
3 QUAY 3
1 DEAT
2 DATE BET 1900 AND 1910
1 FAMS @F1@
0 @I2@ INDI
1 NAME Marie /Durand/
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 NAME Louis /Dupont/
1 SEX M
1 BIRT
2 DATE 2 FEB 1880
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 1878
2 PLAC Toul
0 TRLR
"""


def test_import_gedcom(db):
    stats = import_gedcom(db, SAMPLE.encode("utf-8"))
    assert stats["persons"] == 3 and stats["families"] == 1 and stats["sources"] == 1 and stats["relations"] == 2
    jean = db.query(Person).filter_by(given_names="Jean").one()
    b = next(e for e in jean.events if e.event_type == "birth")
    assert b.date_kind == "approx" and b.sort_year == 1850 and b.place.name == "Toul"
    d = next(e for e in jean.events if e.event_type == "death")
    assert d.date_kind == "between" and d.date_end == "1910"
    assert db.query(Source).one().reference == "5 E 12"


def test_export_puis_reimport(db):
    f = build_fictional_family(db)
    text = export_gedcom(db, hide_living=False)
    assert "0 HEAD" in text and "0 TRLR" in text and "ABT 1930" in text and "Kowalski" in text
    assert "PEDI step" in text  # famille recomposée conservée
    # Réimport dans une base vide équivalente : mêmes effectifs
    for t in (ParentChild, Person):
        db.query(t).delete()
    db.flush()
    stats = import_gedcom(db, text.encode("utf-8"))
    assert stats["persons"] == 10
    assert stats["relations"] >= 6


def test_export_masque_les_vivants(db):
    build_fictional_family(db)
    text = export_gedcom(db, hide_living=True)
    assert "Personne vivante" in text and "Camille" not in text

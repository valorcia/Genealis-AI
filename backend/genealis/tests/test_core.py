from genealis.services.gendate import parse_gendate, republican_to_gregorian, to_gedcom
from genealis.services.names import name_similarity, given_names_similarity, surname_key


def test_dates_exactes_et_modificateurs():
    assert parse_gendate("12/03/1895").start == "1895-03-12"
    assert parse_gendate("vers 1895").kind == "approx"
    assert parse_gendate("avant 1900").kind == "before"
    g = parse_gendate("entre 1890 et 1900")
    assert (g.kind, g.start, g.end) == ("between", "1890", "1900")
    assert parse_gendate("ABT 1895").kind == "approx"
    assert parse_gendate("BET 1890 AND 1900").end == "1900"
    assert parse_gendate("le 1er janvier 1850").start == "1850-01-01"
    assert parse_gendate("").kind == "unknown"
    assert parse_gendate("inconnue").kind == "unknown"


def test_calendrier_republicain():
    assert republican_to_gregorian(1, 0, 1).isoformat() == "1792-09-22"
    g = parse_gendate("18 brumaire an VIII")
    assert g.calendar == "republican" and g.start == "1799-11-09"


def test_gedcom_roundtrip_dates():
    assert to_gedcom(parse_gendate("vers 1895")) == "ABT 1895"
    assert to_gedcom(parse_gendate("12/03/1895")) == "12 MAR 1895"
    assert to_gedcom(parse_gendate("entre 1890 et 1900")) == "BET 1890 AND 1900"


def test_variantes_de_noms():
    assert name_similarity("Dupont", "Dupond") > 80
    assert name_similarity("Kowalski", "Kowalsky") > 85
    assert name_similarity("Rossi", "Durand") < 50
    assert surname_key("de la Fontaine") == surname_key("Lafontaine")
    assert given_names_similarity("Jean Marie", "Jean") >= 85
    assert given_names_similarity("Jean", "Pierre") < 50

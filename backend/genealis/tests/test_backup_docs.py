from pathlib import Path

from genealis import config
from genealis.ai.documents import detect_language, rule_based_extract
from genealis.services.backup import create_backup, list_backups, restore_backup
from genealis.services.media_service import import_file
from genealis.tests.fixtures import build_fictional_family


def test_sauvegarde_et_restauration(db):
    build_fictional_family(db)
    db.commit()
    config.settings.db_filename = "test.db"
    p = create_backup(keep=5)
    assert p.exists() and list_backups()[0]["name"] == p.name
    enc = create_backup(passphrase="secret", keep=5)
    assert enc.suffix == ".enc"
    res = restore_backup(enc.name, passphrase="secret")
    assert res["restored"] == enc.name


def test_import_document_integrite(db, tmp_path):
    f = build_fictional_family(db)
    from PIL import Image

    img = tmp_path / "acte.png"
    Image.new("RGB", (200, 100), "white").save(img)
    m = import_file(db, img, person_id=f["father"].id, title="Acte test")
    assert Path(m.path).exists() and m.sha256
    original = Path(m.path).read_bytes()
    m2 = import_file(db, img, person_id=f["father"].id)
    assert m2.id == m.id  # doublon détecté par empreinte
    assert Path(m.path).read_bytes() == original  # fichier original jamais modifié


def test_extraction_par_regles():
    txt = ("L'an mil huit cent quatre-vingt-quinze, le douze mars, est né Jean, fils de Louis Dupont, cultivateur, "
           "et de Marie Durand, son épouse. Né le 12 mars 1895 à Nancy.")
    ex = rule_based_extract(txt)
    assert detect_language(txt) == "fr"
    assert ex["document_type"] == "birth"
    roles = {p["role"]: p["surname"] for p in ex["persons"]}
    assert roles["father"].startswith("Louis") and roles["mother"].startswith("Marie")
    assert "cultivateur" in ex["occupations"] and ex["place"] == "Nancy"

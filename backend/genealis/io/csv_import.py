"""Import CSV de personnes (séparateur ; ou ,) : colonnes reconnues en français ou anglais."""
from __future__ import annotations

import csv
import io

from sqlalchemy.orm import Session

from ..schemas import PersonIn
from ..services.persons import create_person

COLS = {"prenoms": "given_names", "prénoms": "given_names", "prenom": "given_names", "prénom": "given_names", "given_names": "given_names",
        "nom": "surname", "surname": "surname", "nom_naissance": "surname", "nom_marital": "married_name", "sexe": "sex", "sex": "sex",
        "naissance": "birth_date", "date_naissance": "birth_date", "birth_date": "birth_date", "lieu_naissance": "birth_place",
        "birth_place": "birth_place", "deces": "death_date", "décès": "death_date", "date_deces": "death_date", "death_date": "death_date",
        "lieu_deces": "death_place", "death_place": "death_place", "profession": "occupation", "occupation": "occupation",
        "nationalite": "nationality", "nationalité": "nationality", "notes": "notes"}


def import_csv(db: Session, data: bytes) -> dict:
    text = data.decode("utf-8-sig", errors="replace")
    dialect = csv.Sniffer().sniff(text[:2000], delimiters=";,\t") if text.strip() else csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    created, skipped = 0, 0
    for row in reader:
        fields = {}
        for k, v in row.items():
            key = COLS.get((k or "").strip().lower())
            if key and v and v.strip():
                fields[key] = v.strip()
        if "sex" in fields:
            fields["sex"] = fields["sex"].upper()[:1] if fields["sex"].upper()[:1] in "MF" else None
        if not fields.get("surname") and not fields.get("given_names"):
            skipped += 1
            continue
        create_person(db, PersonIn(**fields))
        created += 1
    return {"created": created, "skipped": skipped}

"""Jeux de données FICTIFS pour les tests (homonymes, contradictions, parents inconnus, familles recomposées,
changements de nom, migrations, archives manquantes). Jamais mélangés à l'arbre réel."""
from __future__ import annotations

from sqlalchemy.orm import Session

from genealis.models import Citation, Source
from genealis.schemas import EventIn, FamilyIn, PersonIn, RelationIn
from genealis.services.persons import add_event, add_relation, create_family, create_person


def build_fictional_family(db: Session) -> dict:
    """Famille fictive DURANT-ROSSI-KOWALSKI (Lorraine / Italie / Pologne)."""
    me = create_person(db, PersonIn(given_names="Camille", surname="Durant", sex="F", birth_date="12/05/1990", birth_place="Nancy, Meurthe-et-Moselle, France", is_root=True, is_living=True))
    father = create_person(db, PersonIn(given_names="Pierre", surname="Durant", sex="M", birth_date="03/02/1960", birth_place="Nancy", occupation="ingénieur"))
    mother = create_person(db, PersonIn(given_names="Anna", surname="Rossi", married_name="Durant", sex="F", birth_date="1962", birth_place="Lunéville"))
    gf = create_person(db, PersonIn(given_names="Jean Marie", surname="Durant", sex="M", birth_date="vers 1930", birth_place="Toul", death_date="1998", death_place="Nancy", occupation="cheminot"))
    gm = create_person(db, PersonIn(given_names="Marie", surname="Kowalski", sex="F", birth_date="1932", birth_place="Varsovie, Pologne", death_date="2005", death_place="Nancy"))
    mgf = create_person(db, PersonIn(given_names="Giuseppe", surname="Rossi", sex="M", birth_date="1928", birth_place="Udine, Italie", death_date="1990"))
    # Homonyme : un autre Jean Durant né 2 ans plus tôt à Nancy
    homonym = create_person(db, PersonIn(given_names="Jean", surname="Durant", sex="M", birth_date="1928", birth_place="Nancy"))
    # Contradiction : enfant né après le décès de la mère
    ghost_mother = create_person(db, PersonIn(given_names="Louise", surname="Martin", sex="F", birth_date="1900", death_date="1925"))
    late_child = create_person(db, PersonIn(given_names="Paul", surname="Martin", sex="M", birth_date="1930"))
    add_relation(db, RelationIn(parent_id=ghost_mother.id, child_id=late_child.id, relation_type="biological"))
    for parent in (father, mother):
        add_relation(db, RelationIn(parent_id=parent.id, child_id=me.id))
    add_relation(db, RelationIn(parent_id=gf.id, child_id=father.id))
    add_relation(db, RelationIn(parent_id=gm.id, child_id=father.id))
    add_relation(db, RelationIn(parent_id=mgf.id, child_id=mother.id))
    create_family(db, FamilyIn(partner1_id=father.id, partner2_id=mother.id, marriage_date="15/06/1988", marriage_place="Nancy"))
    create_family(db, FamilyIn(partner1_id=gf.id, partner2_id=gm.id, marriage_date="1955", marriage_place="Nancy"))
    # Famille recomposée : beau-parent
    step = create_person(db, PersonIn(given_names="Marc", surname="Lefèvre", sex="M", birth_date="1958"))
    add_relation(db, RelationIn(parent_id=step.id, child_id=me.id, relation_type="step"))
    # Migration : Giuseppe arrive en France en 1950
    add_event(db, mgf.id, EventIn(event_type="immigration", date="1950", place="Nancy"))
    # Source primaire sur la filiation Pierre -> Jean Marie
    src = Source(title="Acte de naissance de Pierre Durant (fictif)", repository="AD54 (fictif)", reference="2E 394/12", year=1960,
                 page="vue 12", reliability="primary", transcription="L'an mil neuf cent soixante... est né Pierre, fils de Jean Marie Durant, cheminot, et de Marie Kowalski")
    db.add(src)
    db.flush()
    rel = [r for r in db.query(__import__("genealis.models", fromlist=["ParentChild"]).ParentChild).all() if r.parent_id == gf.id and r.child_id == father.id][0]
    db.add(Citation(source_id=src.id, target_type="parent_child", target_id=rel.id, confidence="green", excerpt="fils de Jean Marie Durant"))
    db.add(Citation(source_id=src.id, target_type="person", target_id=father.id, confidence="green"))
    # Deuxième source indépendante (livret de famille) sur la même filiation
    src2 = Source(title="Livret de famille Durant-Kowalski (fictif)", repository="Archives familiales", reliability="primary")
    db.add(src2)
    db.flush()
    db.add(Citation(source_id=src2.id, target_type="parent_child", target_id=rel.id, confidence="green"))
    # Copie du même acte (même cote) : ne doit pas compter comme source indépendante
    src3 = Source(title="Copie de l'acte de naissance de Pierre Durant", repository="AD54 (fictif)", reference="2E 394/12", year=1960, page="vue 12", reliability="primary")
    db.add(src3)
    db.flush()
    rel_mother = [r for r in db.query(__import__("genealis.models", fromlist=["ParentChild"]).ParentChild).all() if r.parent_id == gm.id and r.child_id == father.id][0]
    db.add(Citation(source_id=src.id, target_type="parent_child", target_id=rel_mother.id, confidence="green"))
    db.add(Citation(source_id=src3.id, target_type="parent_child", target_id=rel_mother.id, confidence="green"))
    db.flush()
    return {"me": me, "father": father, "mother": mother, "gf": gf, "gm": gm, "mgf": mgf, "homonym": homonym,
            "ghost_mother": ghost_mother, "late_child": late_child, "step": step, "rel_gf": rel, "rel_gm": rel_mother}

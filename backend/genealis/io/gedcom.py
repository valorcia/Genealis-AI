"""Import / export GEDCOM 5.5.1 avec conservation des provenances et incertitudes."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Citation, Event, Family, ParentChild, Person, Source
from ..schemas import EventIn, FamilyIn, PersonIn, RelationIn
from ..services.gendate import GenDate, to_gedcom
from ..services.persons import add_event, add_relation, apply_event_fields, create_family, create_person, index_person

EVENT_TAGS = {"BIRT": "birth", "CHR": "baptism", "BAPM": "baptism", "DEAT": "death", "BURI": "burial", "CREM": "cremation",
              "EDUC": "education", "GRAD": "graduation", "RETI": "retirement", "CONF": "confirmation", "FCOM": "first_communion",
              "RESI": "residence", "CENS": "census", "OCCU": "occupation", "IMMI": "immigration", "EMIG": "emigration",
              "NATU": "naturalization", "WILL": "will", "PROB": "probate", "MILI": "military", "_MILI": "military",
              "EVEN": "other"}
FAM_EVENT_TAGS = {"MARR": "marriage", "MARB": "marriage_banns", "MARC": "marriage_contract", "DIV": "divorce",
                  "ENGA": "engagement", "MARL": "marriage_license", "DIVF": "separation"}
REV_EVENT_TAGS = {v: k for k, v in EVENT_TAGS.items() if k not in ("CHR", "_MILI")}
REV_FAM_TAGS = {v: k for k, v in FAM_EVENT_TAGS.items()}


@dataclass
class Node:
    level: int
    tag: str
    value: str = ""
    xref: str | None = None
    children: list["Node"] = field(default_factory=list)

    def get(self, tag: str) -> "Node | None":
        return next((c for c in self.children if c.tag == tag), None)

    def all(self, tag: str) -> list["Node"]:
        return [c for c in self.children if c.tag == tag]

    def text(self, tag: str) -> str | None:
        n = self.get(tag)
        return n.full_value() if n else None

    def full_value(self) -> str:
        out = self.value
        for c in self.children:
            if c.tag == "CONT":
                out += "\n" + c.value
            elif c.tag == "CONC":
                out += c.value
        return out


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    head = data[:500].upper()
    if b"ANSEL" in head:
        return _ansel_decode(data)
    return data.decode("latin-1")


def _ansel_decode(data: bytes) -> str:
    """Décodage ANSEL simplifié (accents courants du français)."""
    combining = {0xE1: "̀", 0xE2: "́", 0xE3: "̂", 0xE4: "̃", 0xE5: "̄", 0xE8: "̈",
                 0xF0: "̧"}
    out = []
    i = 0
    while i < len(data):
        b = data[i]
        if b in combining and i + 1 < len(data):
            out.append(chr(data[i + 1]) + combining[b])
            i += 2
            continue
        out.append(chr(b) if b < 0x80 else "?")
        i += 1
    import unicodedata

    return unicodedata.normalize("NFC", "".join(out))


_LINE = re.compile(r"^\s*(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_]+)(?:\s(.*))?$")


def parse(text: str) -> list[Node]:
    roots: list[Node] = []
    stack: list[Node] = []
    for raw in text.splitlines():
        if not raw.strip():
            continue
        m = _LINE.match(raw)
        if not m:
            continue
        level = int(m.group(1))
        node = Node(level, m.group(3).upper(), (m.group(4) or "").rstrip("\r"), m.group(2))
        while stack and stack[-1].level >= level:
            stack.pop()
        if stack:
            stack[-1].children.append(node)
        else:
            roots.append(node)
        stack.append(node)
    return roots


def _split_name(name: str) -> tuple[str | None, str | None]:
    m = re.match(r"^(.*?)\s*/([^/]*)/\s*(.*)$", name or "")
    if m:
        given = (m.group(1) + " " + m.group(3)).strip() or None
        return given, (m.group(2).strip() or None)
    return (name.strip() or None), None


def import_gedcom(db: Session, data: bytes, *, mark_imported: bool = True) -> dict:
    text = _decode(data)
    roots = parse(text)
    persons: dict[str, Person] = {}
    sources: dict[str, Source] = {}
    stats = {"persons": 0, "families": 0, "sources": 0, "relations": 0, "events": 0, "warnings": []}

    # Sources
    for n in roots:
        if n.tag == "SOUR" and n.xref:
            title = n.text("TITL") or n.text("ABBR") or n.xref
            s = Source(title=title, repository=n.text("REPO") and _repo_name(roots, n.text("REPO")),
                       reference=n.text("REFN") or n.text("CALN"), transcription=n.text("TEXT"),
                       reliability="unknown", gedcom_xref=n.xref)
            pub = n.text("PUBL")
            if pub:
                s.extra = {"publication": pub}
            db.add(s)
            db.flush()
            sources[n.xref] = s
            stats["sources"] += 1

    def cite(node: Node, target_type: str, target_id: str) -> None:
        for sc in node.all("SOUR"):
            src = sources.get(sc.value.strip())
            if src is None:
                # Source en ligne (sans xref)
                src = Source(title=sc.full_value()[:500] or "Source importée", reliability="unknown")
                db.add(src)
                db.flush()
            page = sc.text("PAGE")
            quay = sc.text("QUAY")
            conf = {"3": "green", "2": "orange", "1": "orange", "0": "red"}.get((quay or "").strip(), "orange")
            data_node = sc.get("DATA")
            excerpt = data_node.text("TEXT") if data_node else None
            db.add(Citation(source_id=src.id, target_type=target_type, target_id=target_id, excerpt=excerpt,
                            note=f"page {page}" if page else None, confidence=conf))

    # Individus
    for n in roots:
        if n.tag != "INDI" or not n.xref:
            continue
        given, surname = _split_name(n.text("NAME") or "")
        name_node = n.get("NAME")
        variants = []
        if name_node:
            if name_node.text("GIVN") and not given:
                given = name_node.text("GIVN")
            if name_node.text("SURN") and not surname:
                surname = name_node.text("SURN")
            if name_node.text("NICK"):
                variants.append(name_node.text("NICK"))
        for extra_name in n.all("NAME")[1:]:
            g2, s2 = _split_name(extra_name.value)
            variants.append(" ".join(x for x in (g2, s2) if x))
        sex = (n.text("SEX") or "").strip().upper()[:1] or None
        if sex not in ("M", "F"):
            sex = None
        notes = "\n".join(c.full_value() for c in n.all("NOTE") if not c.value.startswith("@")) or None
        p = create_person(db, PersonIn(given_names=given, surname=surname, name_variants=variants, sex=sex, notes=notes))
        p.gedcom_xref = n.xref
        occ = n.get("OCCU")
        if occ:
            p.occupation = occ.value or None
        cite(n, "person", p.id)
        for child in n.children:
            if child.tag in EVENT_TAGS:
                etype = EVENT_TAGS[child.tag]
                if child.tag == "EVEN" and child.text("TYPE"):
                    desc = child.text("TYPE")
                else:
                    desc = child.text("NOTE")
                ev = add_event(db, p.id, EventIn(event_type=etype, date=child.text("DATE"), place=child.text("PLAC"),
                                                 description=desc, value_original=child.value or None,
                                                 attributes={"age": child.text("AGE")} if child.text("AGE") else {}))
                cite(child, "event", ev.id)
                stats["events"] += 1
        persons[n.xref] = p
        stats["persons"] += 1

    # Familles
    for n in roots:
        if n.tag != "FAM" or not n.xref:
            continue
        h = persons.get((n.text("HUSB") or "").strip())
        w = persons.get((n.text("WIFE") or "").strip())
        fam = create_family(db, FamilyIn(partner1_id=h.id if h else None, partner2_id=w.id if w else None,
                                         union_type="marriage" if n.get("MARR") else "unknown"))
        fam.gedcom_xref = n.xref
        cite(n, "family", fam.id)
        for child in n.children:
            if child.tag in FAM_EVENT_TAGS:
                ev = Event(family_id=fam.id)
                apply_event_fields(db, ev, EventIn(event_type=FAM_EVENT_TAGS[child.tag], date=child.text("DATE"),
                                                   place=child.text("PLAC"), description=child.text("NOTE")))
                db.add(ev)
                db.flush()
                cite(child, "event", ev.id)
                stats["events"] += 1
        for c in n.all("CHIL"):
            kid = persons.get(c.value.strip())
            if not kid:
                continue
            pedi = (c.text("PEDI") or "").lower()
            rtype = {"adopted": "adoptive", "foster": "foster", "step": "step"}.get(pedi, "biological")
            for parent in (h, w):
                if parent:
                    try:
                        add_relation(db, RelationIn(parent_id=parent.id, child_id=kid.id, relation_type=rtype))
                        stats["relations"] += 1
                    except ValueError as exc:
                        stats["warnings"].append(str(exc))
        stats["families"] += 1

    for p in persons.values():
        db.refresh(p)
        index_person(db, p)
    db.flush()
    return stats


def _repo_name(roots: list[Node], xref: str | None) -> str | None:
    if not xref:
        return None
    for n in roots:
        if n.tag == "REPO" and n.xref == xref.strip():
            return n.text("NAME")
    return xref


# ---------------- Export ----------------

def _esc_lines(level: int, tag: str, value: str | None) -> list[str]:
    if value is None or value == "":
        return [f"{level} {tag}"]
    lines = str(value).split("\n")
    out = [f"{level} {tag} {lines[0][:240]}"]
    for ln in lines[1:]:
        out.append(f"{level + 1} CONT {ln[:240]}")
    return out


def export_gedcom(db: Session, *, hide_living: bool = True, only: set[str] | None = None) -> str:
    persons = db.execute(select(Person)).scalars().all()
    families = list(db.execute(select(Family)).scalars().all())
    if only is not None:
        persons = [p for p in persons if p.id in only]
        families = [f for f in families if f.partner1_id in only or f.partner2_id in only]
    sources = db.execute(select(Source)).scalars().all()
    # Parents sans famille enregistrée (parent isolé, beau-parent) : famille monoparentale synthétique
    covered = {f.partner1_id for f in families} | {f.partner2_id for f in families}
    for rel in db.execute(select(ParentChild)).scalars():
        if only is not None and (rel.parent_id not in only or rel.child_id not in only):
            continue
        if rel.parent_id not in covered:
            parent = db.get(Person, rel.parent_id)
            synth = Family(id=f"synth-{rel.parent_id}", partner1_id=rel.parent_id if (parent and parent.sex != "F") else None,
                           partner2_id=rel.parent_id if (parent and parent.sex == "F") else None, union_type="unknown", confidence="grey")
            synth.events = []
            families.append(synth)
            covered.add(rel.parent_id)
    pid = {p.id: f"@I{i + 1}@" for i, p in enumerate(persons)}
    fid = {f.id: f"@F{i + 1}@" for i, f in enumerate(families)}
    sid = {s.id: f"@S{i + 1}@" for i, s in enumerate(sources)}
    out = ["0 HEAD", "1 SOUR GENEALIS_AI", "2 VERS 0.1", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED",
           "1 CHAR UTF-8", f"1 DATE {datetime.now().strftime('%d %b %Y').upper()}"]

    cit_by_target: dict[tuple[str, str], list[Citation]] = {}
    for c in db.execute(select(Citation)).scalars():
        cit_by_target.setdefault((c.target_type, c.target_id), []).append(c)

    def cites(level: int, ttype: str, tid: str) -> list[str]:
        lines = []
        for c in cit_by_target.get((ttype, tid), []):
            if c.source_id not in sid:
                continue
            lines.append(f"{level} SOUR {sid[c.source_id]}")
            if c.note:
                lines.append(f"{level + 1} PAGE {c.note}")
            quay = {"green": 3, "orange": 2, "red": 0, "grey": 1}.get(c.confidence, 1)
            lines.append(f"{level + 1} QUAY {quay}")
            if c.excerpt:
                lines.append(f"{level + 1} DATA")
                lines.extend(_esc_lines(level + 2, "TEXT", c.excerpt))
        return lines

    def event_lines(level: int, e: Event, tag: str) -> list[str]:
        lines = [f"{level} {tag}" + (f" {e.value_original}" if tag == "EVEN" and e.value_original else "")]
        if tag == "EVEN" and e.description:
            lines.append(f"{level + 1} TYPE {e.description}")
        gd = to_gedcom(GenDate(e.date_original, e.date_kind, e.date_start, e.date_end, e.calendar, e.sort_year))
        if gd:
            lines.append(f"{level + 1} DATE {gd}")
            if e.calendar == "republican" and e.date_original:
                lines.append(f"{level + 2} NOTE Date originale : {e.date_original}")
        place = e.place.display() if e.place else e.place_original
        if place:
            lines.append(f"{level + 1} PLAC {place}")
        if e.description and tag != "EVEN":
            lines.extend(_esc_lines(level + 1, "NOTE", e.description))
        if e.confidence and e.confidence != "grey":
            lines.append(f"{level + 1} NOTE Confiance GENEALIS : {e.confidence}")
        lines.extend(cites(level + 1, "event", e.id))
        return lines

    for p in persons:
        out.append(f"0 {pid[p.id]} INDI")
        if hide_living and p.is_living:
            out.append("1 NAME Personne vivante /" + (p.surname or "") + "/")
            out.append("1 NOTE Données masquées (personne vivante)")
            continue
        out.append(f"1 NAME {p.given_names or ''} /{p.surname or ''}/")
        if p.given_names:
            out.append(f"2 GIVN {p.given_names}")
        if p.surname:
            out.append(f"2 SURN {p.surname}")
        if p.married_name:
            out.append(f"1 NAME {p.given_names or ''} /{p.married_name}/")
            out.append("2 TYPE married")
        for v in p.name_variants or []:
            out.append(f"1 NAME {v}")
            out.append("2 TYPE aka")
        if p.sex:
            out.append(f"1 SEX {p.sex}")
        if p.occupation:
            out.append(f"1 OCCU {p.occupation}")
        if p.nationality:
            out.append(f"1 NATI {p.nationality}")
        for e in p.events:
            tag = REV_EVENT_TAGS.get(e.event_type, "EVEN")
            out.extend(event_lines(1, e, tag))
        if p.notes:
            out.extend(_esc_lines(1, "NOTE", p.notes))
        out.append(f"1 NOTE Confiance GENEALIS : {p.confidence}")
        out.extend(cites(1, "person", p.id))
        for f in families:
            if p.id in (f.partner1_id, f.partner2_id):
                out.append(f"1 FAMS {fid[f.id]}")
        for r in db.execute(select(ParentChild).where(ParentChild.child_id == p.id)).scalars():
            for f in families:
                if r.parent_id in (f.partner1_id, f.partner2_id):
                    out.append(f"1 FAMC {fid[f.id]}")
                    if r.relation_type != "biological":
                        pedi = {"adoptive": "adopted", "foster": "foster", "step": "step"}.get(r.relation_type, "birth")
                        out.append(f"2 PEDI {pedi}")
                        if r.relation_type == "uncertain":
                            out.append("3 NOTE Filiation incertaine (GENEALIS)")
                    break

    for f in families:
        out.append(f"0 {fid[f.id]} FAM")
        if f.partner1_id in pid:
            out.append(f"1 HUSB {pid[f.partner1_id]}")
        if f.partner2_id in pid:
            out.append(f"1 WIFE {pid[f.partner2_id]}")
        kids: set[str] = set()
        for parent in (f.partner1_id, f.partner2_id):
            if parent:
                for r in db.execute(select(ParentChild).where(ParentChild.parent_id == parent)).scalars():
                    kids.add(r.child_id)
        for k in sorted(kids):
            if k in pid:
                out.append(f"1 CHIL {pid[k]}")
        for e in f.events:
            out.extend(event_lines(1, e, REV_FAM_TAGS.get(e.event_type, "EVEN")))
        out.append(f"1 NOTE Confiance GENEALIS : {f.confidence}")
        out.extend(cites(1, "family", f.id))

    for s in sources:
        out.append(f"0 {sid[s.id]} SOUR")
        out.append(f"1 TITL {s.title}")
        if s.repository:
            out.append(f"1 NOTE Organisme : {s.repository}")
        if s.reference:
            out.append(f"1 REFN {s.reference}")
        meta = ", ".join(x for x in (s.fonds, s.commune, s.register_type, str(s.year) if s.year else None,
                                     f"vue {s.page}" if s.page else None) if x)
        if meta:
            out.append(f"1 PUBL {meta}")
        if s.url:
            out.append(f"1 NOTE URL : {s.url}")
        if s.transcription:
            out.extend(_esc_lines(1, "TEXT", s.transcription))
        out.append(f"1 NOTE Fiabilité GENEALIS : {s.reliability}")
    out.append("0 TRLR")
    return "\n".join(out) + "\n"

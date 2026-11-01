"""Exports : PDF (fiche, rapport, arbre), CSV sources, rapport généalogique."""
from __future__ import annotations

import csv
import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Person, Source
from ..services.narrative import family_narrative, person_narrative
from ..services.persons import person_detail
from ..services.tree import ancestors_graph

CONF_LABEL = {"green": "établi", "orange": "à vérifier", "red": "contradiction", "grey": "inconnu"}
CONF_COLOR = {"green": colors.HexColor("#7a9a7e"), "orange": colors.HexColor("#c9a227"), "red": colors.HexColor("#b4473c"),
              "grey": colors.HexColor("#9a9a9a")}


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle("H1g", parent=ss["Heading1"], textColor=colors.HexColor("#0f1e3a"), fontSize=18))
    ss.add(ParagraphStyle("H2g", parent=ss["Heading2"], textColor=colors.HexColor("#0f1e3a"), fontSize=13))
    ss.add(ParagraphStyle("Src", parent=ss["Normal"], fontSize=8, textColor=colors.HexColor("#555555"), leftIndent=12))
    ss.add(ParagraphStyle("Body", parent=ss["Normal"], fontSize=10, leading=14))
    return ss


def _esc(s) -> str:
    return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def person_sheet_pdf(db: Session, p: Person) -> bytes:
    ss = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm,
                            title=f"Fiche – {p.display_name()}", author="GENEALIS AI")
    story = _person_story(db, p, ss)
    doc.build(story)
    return buf.getvalue()


def _person_story(db: Session, p: Person, ss) -> list:
    d = person_detail(db, p)
    story = [Paragraph(_esc(d.display_name), ss["H1g"]),
             Paragraph(f"Niveau de confiance : <b>{CONF_LABEL.get(d.confidence, d.confidence)}</b> — généré le {datetime.now():%d/%m/%Y}", ss["Body"]),
             Spacer(1, 8)]
    rows = [["Identité", ""]]
    rows += [["Prénoms", d.given_names or "—"], ["Nom de naissance", d.surname or "—"], ["Nom marital", d.married_name or "—"],
             ["Sexe", d.sex or "non documenté"], ["Profession", d.occupation or "—"], ["Nationalité", d.nationality or "—"],
             ["Variantes", ", ".join(d.name_variants) or "—"]]
    t = Table(rows, colWidths=[5 * cm, 11 * cm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f1e3a")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                           ("FONTSIZE", (0, 0), (-1, -1), 9), ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey)]))
    story += [t, Spacer(1, 10), Paragraph("Chronologie personnelle", ss["H2g"])]
    for e in d.events:
        story.append(Paragraph(f"<b>{_esc(e.date_display)}</b> — {_esc(e.event_type)}" + (f" à {_esc(e.place_name or e.place_original)}" if (e.place_name or e.place_original) else "")
                               + f" <font color='#777'>[{CONF_LABEL.get(e.confidence, e.confidence)}]</font>", ss["Body"]))
        for c in e.citations:
            story.append(Paragraph(f"Source : {_esc(c.source_title)}" + (f" — « {_esc(c.excerpt)} »" if c.excerpt else ""), ss["Src"]))
    story += [Spacer(1, 8), Paragraph("Famille", ss["H2g"])]
    story.append(Paragraph("Parents : " + (", ".join(f"{_esc(x.display_name)} [{CONF_LABEL.get(r.confidence)}]" for x, r in zip(d.parents, d.parent_relations)) or "inconnus"), ss["Body"]))
    story.append(Paragraph("Conjoint(s) : " + (", ".join(_esc(x.display_name) for x in d.spouses) or "—"), ss["Body"]))
    story.append(Paragraph("Enfants : " + (", ".join(_esc(x.display_name) for x in d.children) or "—"), ss["Body"]))
    story.append(Paragraph("Frères et sœurs : " + (", ".join(_esc(x.display_name) for x in d.siblings) or "—"), ss["Body"]))
    if d.hypotheses:
        story += [Spacer(1, 8), Paragraph("Hypothèses (non confirmées)", ss["H2g"])]
        for h in d.hypotheses:
            story.append(Paragraph(f"• {_esc(h.title)} — statut {h.status}, score {h.score or '—'}", ss["Body"]))
    if d.contradictions:
        story += [Spacer(1, 8), Paragraph("Contradictions ouvertes", ss["H2g"])]
        for c in d.contradictions:
            story.append(Paragraph(f"• [{c.severity}] {_esc(c.description)}", ss["Body"]))
    narr = person_narrative(db, p)
    story += [Spacer(1, 8), Paragraph("Biographie documentée", ss["H2g"])]
    for para in narr["paragraphs"]:
        story.append(Paragraph(_esc(para["text"]) + f" <font color='#777'>[{CONF_LABEL.get(para['confidence'], para['confidence'])}]</font>", ss["Body"]))
        for s in para["sources"]:
            story.append(Paragraph(f"Source : {_esc(s.get('source_title'))}", ss["Src"]))
    return story


def family_report_pdf(db: Session, root_id: str, max_generations: int = 6) -> bytes:
    ss = _styles()
    buf = io.BytesIO()
    root = db.get(Person, root_id)
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm,
                            title=f"Rapport généalogique – {root.display_name() if root else ''}", author="GENEALIS AI")
    g = ancestors_graph(db, root_id, max_generations)
    story = [Paragraph(f"Rapport généalogique — ascendance de {_esc(root.display_name() if root else '?')}", ss["H1g"]),
             Paragraph(f"{len(g['nodes'])} personnes sur {g['generations']} génération(s). Généré le {datetime.now():%d/%m/%Y} par GENEALIS AI. "
                       "Chaque affirmation est accompagnée de son niveau de confiance et de ses sources ; les hypothèses ne sont pas des faits.", ss["Body"]),
             Spacer(1, 10), Paragraph("Tableau d'ascendance (numérotation Sosa)", ss["H2g"])]
    rows = [["Sosa", "Nom", "Naissance", "Décès", "Confiance"]]
    for n in sorted(g["nodes"], key=lambda n: min(n["sosa"] or [10**9])):
        rows.append([", ".join(str(s) for s in n["sosa"]) or "—", n["display_name"], f"{n.get('birth_display') or '?'} {n.get('birth_place') or ''}".strip(),
                     f"{n.get('death_display') or '?'} {n.get('death_place') or ''}".strip(), CONF_LABEL.get(n["confidence"], n["confidence"])])
    t = Table(rows, colWidths=[1.5 * cm, 5 * cm, 4.5 * cm, 4.5 * cm, 2 * cm], repeatRows=1)
    style = [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f1e3a")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
             ("FONTSIZE", (0, 0), (-1, -1), 8), ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey)]
    for i, n in enumerate(sorted(g["nodes"], key=lambda n: min(n["sosa"] or [10**9])), start=1):
        style.append(("TEXTCOLOR", (4, i), (4, i), CONF_COLOR.get(n["confidence"], colors.black)))
    t.setStyle(TableStyle(style))
    story += [t, PageBreak()]
    for narr in family_narrative(db, root_id, max_generations):
        p = db.get(Person, narr["person_id"])
        story += _person_story(db, p, ss)
        story.append(PageBreak())
    doc.build(story)
    return buf.getvalue()


def sources_csv(db: Session) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["id", "titre", "organisme", "fonds", "commune", "type_registre", "cote", "annee", "page_vue", "url",
                "consulte_le", "fiabilite", "connecteur", "transcription", "interpretation"])
    for s in db.execute(select(Source)).scalars():
        w.writerow([s.id, s.title, s.repository, s.fonds, s.commune, s.register_type, s.reference, s.year, s.page, s.url,
                    s.consulted_at.isoformat() if s.consulted_at else "", s.reliability, s.connector_id,
                    (s.transcription or "").replace("\n", " "), (s.interpretation or "").replace("\n", " ")])
    return buf.getvalue()


def persons_csv(db: Session) -> str:
    from ..services.persons import person_summary

    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["id", "prenoms", "nom", "nom_marital", "sexe", "naissance", "lieu_naissance", "deces", "lieu_deces", "profession", "confiance"])
    for p in db.execute(select(Person)).scalars():
        s = person_summary(db, p)
        w.writerow([s.id, s.given_names, s.surname, s.married_name, s.sex, s.birth_display, s.birth_place, s.death_display,
                    s.death_place, s.occupation, s.confidence])
    return buf.getvalue()

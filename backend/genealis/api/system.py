from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import __version__
from ..agents import engine
from ..agents.assistant import handle as chat_handle
from ..agents.questions import suggest_onboarding_questions
from ..ai.providers import AIClient, test_provider
from ..config import settings
from ..db import get_session
from ..models import ChatMessage, Person, TransmissionLog
from ..schemas import ChatIn, ChatOut, OnboardingIn, PersonIn, QuickStartIn, RelationIn, SettingsPatch
from ..services import backup as backup_svc
from ..services import settings_service as cfg
from ..services.confidence import recompute_all
from ..services.consistency import run_all as run_consistency
from ..services.fts import search as fts_search
from ..services.journal import log
from ..services.persons import add_relation, create_person, find_or_create_family, person_detail

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health():
    import os

    detected = [k for k in ("GENEALIS_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "DATABASE_URL_UNPOOLED",
                            "NEON_DATABASE_URL", "BLOB_READ_WRITE_TOKEN", "ACCESS_TOKEN", "CRON_SECRET", "SECRET_KEY", "VERCEL")
                if os.environ.get(k)]
    return {"status": "ok", "version": __version__, "data_dir": str(settings.data_dir), "serverless": settings.serverless,
            "auth_required": bool(settings.access_token),
            "database": "postgresql" if (settings.database_url or "").startswith("postgresql") else "sqlite",
            "secret_key_set": bool(settings.secret_key), "env_detected": detected,
            "database_env": getattr(settings, "database_env", None)}


@router.post("/auth/login")
def login(body: dict):
    """Vérifie le mot de passe d'accès et pose un cookie (mode hébergé)."""
    from fastapi.responses import JSONResponse

    if not settings.access_token:
        return {"ok": True, "auth_required": False}
    if body.get("password") != settings.access_token:
        raise HTTPException(401, "Mot de passe incorrect")
    resp = JSONResponse({"ok": True, "auth_required": True})
    resp.set_cookie("genealis_token", settings.access_token, httponly=True, samesite="lax", secure=settings.serverless,
                    max_age=60 * 60 * 24 * 90)
    return resp


@router.get("/export/json")
def export_json(db: Session = Depends(get_session)):
    """Sauvegarde complète portable (toutes les tables) — utilisée en mode hébergé."""
    from fastapi.responses import Response

    from ..services.backup import export_json as _export

    return Response(_export(db), media_type="application/json",
                    headers={"Content-Disposition": "attachment; filename=genealis-sauvegarde.json"})


@router.post("/import/json")
async def import_json_endpoint(file: UploadFile = File(...), db: Session = Depends(get_session)):
    from ..services.backup import import_json as _import

    stats = _import(db, await file.read())
    db.commit()
    return stats


@router.get("/settings")
def get_settings(db: Session = Depends(get_session)):
    return cfg.all_public(db)


@router.patch("/settings")
def patch_settings(data: SettingsPatch, db: Session = Depends(get_session)):
    for k, v in data.values.items():
        if k not in cfg.DEFAULTS and k not in cfg.SECRET_KEYS:
            raise HTTPException(400, f"Paramètre inconnu : {k}")
        cfg.set_value(db, k, v)
        if k in cfg.SECRET_KEYS:
            log(db, f"Clé « {k} » {'enregistrée' if v else 'supprimée'} (chiffrée localement)", category="decision")
        elif k in ("autonomy_mode", "ai_provider", "allow_external_ai"):
            log(db, f"Paramètre {k} → {v}", category="decision")
    db.commit()
    return cfg.all_public(db)


@router.get("/ai/status")
def ai_status(db: Session = Depends(get_session)):
    return test_provider(db)


@router.get("/ai/gemini/models")
def gemini_models(db: Session = Depends(get_session)):
    return AIClient(db).gemini_models()


@router.get("/ai/ollama/models")
def ollama_models(db: Session = Depends(get_session)):
    return AIClient(db).ollama_models()


@router.get("/transmissions")
def transmissions(limit: int = 200, db: Session = Depends(get_session)):
    rows = db.execute(select(TransmissionLog).order_by(TransmissionLog.id.desc()).limit(limit)).scalars().all()
    return [{"id": r.id, "ts": r.ts, "provider": r.provider, "purpose": r.purpose, "payload_summary": r.payload_summary,
             "bytes_sent": r.bytes_sent, "contains_personal_data": r.contains_personal_data, "authorized": r.authorized} for r in rows]


@router.get("/search")
def global_search(q: str, limit: int = 30, db: Session = Depends(get_session)):
    return fts_search(db.connection(), q, limit=limit)


@router.post("/chat", response_model=ChatOut)
def chat(data: ChatIn, db: Session = Depends(get_session)):
    res = chat_handle(db, data.message)
    db.commit()
    row = db.execute(select(ChatMessage).order_by(ChatMessage.id.desc())).scalars().first()
    return ChatOut(role="assistant", content=res["content"], meta=res["meta"], ts=row.ts)


@router.get("/chat/history", response_model=list[ChatOut])
def chat_history(limit: int = 100, db: Session = Depends(get_session)):
    rows = db.execute(select(ChatMessage).order_by(ChatMessage.id.desc()).limit(limit)).scalars().all()
    return [ChatOut(role=r.role, content=r.content, meta=r.meta or {}, ts=r.ts) for r in reversed(rows)]


@router.delete("/chat/history", status_code=204)
def clear_chat(db: Session = Depends(get_session)):
    db.query(ChatMessage).delete()
    db.commit()


# ---- sauvegardes ----
@router.get("/backups")
def list_backups():
    return backup_svc.list_backups()


@router.post("/backups")
def create_backup(passphrase: str | None = None, db: Session = Depends(get_session)):
    if settings.database_url:
        raise HTTPException(400, "En mode hébergé, utilisez l'export JSON complet (Paramètres → Sauvegardes).")
    db.commit()
    p = backup_svc.create_backup(passphrase=passphrase or None, keep=int(cfg.get(db, "backup_keep", 14)))
    log(db, f"Sauvegarde créée : {p.name}", category="decision")
    db.commit()
    return {"name": p.name, "path": str(p)}


@router.post("/backups/{name}/restore")
def restore_backup(name: str, passphrase: str | None = None, db: Session = Depends(get_session)):
    db.close()
    try:
        return backup_svc.restore_backup(name, passphrase=passphrase or None)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(400, str(exc))


@router.get("/logs/technical")
def technical_log(lines: int = 300):
    path = settings.log_dir / "genealis.log"
    if not path.exists():
        return {"path": str(path), "lines": []}
    content = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return {"path": str(path), "lines": content[-lines:]}


# ---- démarrage rapide : par les grands-parents (ou tout autre couple), sans se saisir soi-même ----
@router.post("/quickstart")
def quickstart(data: QuickStartIn, db: Session = Depends(get_session)):
    from ..schemas import FamilyIn
    from ..services.persons import create_family

    people = [p for p in data.people if (p.given_names or p.surname)]
    if not people:
        raise HTTPException(400, "Indiquez au moins un prénom ou un nom.")
    has_root = db.execute(select(Person).where(Person.is_root == True)).scalars().first() is not None  # noqa: E712
    created = []
    for i, info in enumerate(people[:2]):
        if i == 0 and not has_root:
            info.is_root = True
        if info.is_living is None and (info.death_date or info.death_place):
            info.is_living = False
        created.append(create_person(db, info))
    family = None
    if len(created) == 2 and data.couple:
        a, b = (created[0], created[1]) if created[0].sex != "F" else (created[1], created[0])
        family = create_family(db, FamilyIn(partner1_id=a.id, partner2_id=b.id,
                                            union_type="marriage" if (data.marriage_date or data.marriage_place) else "unknown",
                                            marriage_date=data.marriage_date, marriage_place=data.marriage_place))
    children = []
    for c in data.children:
        if not (c.given_names or c.surname):
            continue
        child = create_person(db, c)
        for parent in created:
            add_relation(db, RelationIn(parent_id=parent.id, child_id=child.id, relation_type="biological",
                                        notes="Déclaré par l'utilisateur au démarrage (à sourcer)"))
        children.append(child)
    cfg.set_value(db, "onboarding_done", True)
    if db.get(__import__("genealis.models", fromlist=["Setting"]).Setting, "autonomy_mode") is None:
        cfg.set_value(db, "autonomy_mode", 3)
    run_consistency(db)
    recompute_all(db)
    for p in created:
        suggest_onboarding_questions(db, p)
    tasks = []
    if data.research:
        for p in created:
            tasks.extend(engine.explore_branch(db, p.id, generations=3, priority=75))
    log(db, f"Démarrage rapide : {', '.join(p.display_name() for p in created)} — {len(tasks)} recherche(s) planifiée(s).",
        category="decision", person_id=created[0].id)
    db.commit()
    return {"persons": [p.id for p in created], "children": [c.id for c in children], "family_id": family.id if family else None,
            "tasks": [t.id for t in tasks], "root_id": created[0].id}


# ---- premier démarrage ----
@router.post("/onboarding")
def onboarding(data: OnboardingIn, db: Session = Depends(get_session)):
    existing_root = db.execute(select(Person).where(Person.is_root == True)).scalars().first()  # noqa: E712
    if existing_root:
        raise HTTPException(400, "L'assistant de configuration a déjà été exécuté.")
    me = create_person(db, PersonIn(given_names=data.given_names, surname=data.surname, sex=data.sex, birth_date=data.birth_date,
                                    birth_place=data.birth_place, is_root=True, is_living=True, confidence="orange"))
    created = {"root": me.id, "parents": [], "grandparents": []}
    parents: dict[str, Person] = {}
    for role, info, sex in (("father", data.father, "M"), ("mother", data.mother, "F")):
        if info and (info.given_names or info.surname):
            info.sex = info.sex or sex
            p = create_person(db, info)
            add_relation(db, RelationIn(parent_id=p.id, child_id=me.id, relation_type="biological", confidence="orange",
                                        notes="Déclaré par l'utilisateur lors de la configuration (à sourcer)"))
            parents[role] = p
            created["parents"].append(p.id)
    if "father" in parents and "mother" in parents:
        find_or_create_family(db, parents["father"].id, parents["mother"].id)
    for gp in data.grandparents:
        side, role = gp.get("side"), gp.get("role")
        parent = parents.get(side)
        if not parent:
            continue
        info = PersonIn(**{k: v for k, v in gp.items() if k in PersonIn.model_fields})
        info.sex = info.sex or ("M" if role == "father" else "F")
        if not (info.given_names or info.surname):
            continue
        g = create_person(db, info)
        add_relation(db, RelationIn(parent_id=g.id, child_id=parent.id, relation_type="biological", confidence="orange",
                                    notes="Déclaré par l'utilisateur lors de la configuration (à sourcer)"))
        created["grandparents"].append(g.id)
    cfg.set_value(db, "onboarding_done", True)
    cfg.set_value(db, "autonomy_mode", data.autonomy_mode)
    if data.origin_countries:
        cfg.set_value(db, "origin_countries", data.origin_countries) if "origin_countries" in cfg.DEFAULTS else None
        me.notes = "Pays d'origine déclarés : " + ", ".join(data.origin_countries)
    if data.documents_note:
        me.notes = (me.notes or "") + "\nDocuments disponibles : " + data.documents_note
    run_consistency(db)
    recompute_all(db)
    log(db, "Configuration initiale terminée : fiches créées à partir des informations fournies.", category="decision", person_id=me.id)
    for pid in [me.id] + created["parents"] + created["grandparents"]:
        p = db.get(Person, pid)
        if p and not p.is_living:
            suggest_onboarding_questions(db, p)
    tasks = []
    if data.start_research:
        for pid in created["parents"] + created["grandparents"] or [me.id]:
            tasks.extend(engine.explore_branch(db, pid, generations=2))
    db.commit()
    return {**created, "tasks": [t.id for t in tasks], "root": person_detail(db, me).model_dump()}

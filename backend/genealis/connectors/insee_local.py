"""Index local du Fichier des personnes décédées (INSEE, open data) – gratuit, sans API, hors ligne.

Les fichiers annuels `deces-AAAA.txt` sont publiés sur data.gouv.fr (licence ouverte). Une fois téléchargés
et importés, les recherches se font entièrement en local, sans aucun service tiers.
Format officiel (largeur fixe, 176 caractères) :
  1-80 nom*prénoms/ | 81 sexe (1=M,2=F) | 82-89 naissance AAAAMMJJ | 90-94 code lieu naissance |
  95-124 commune naissance | 125-154 pays naissance | 155-162 décès AAAAMMJJ | 163-167 code lieu décès | 168-176 n° acte
"""
from __future__ import annotations

import logging
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

from unidecode import unidecode

from ..config import settings
from .base import ArchiveConnector, ConnectorCapabilities, SearchQuery, SearchResult, registry
from .france import UNVERIFIED

logger = logging.getLogger("genealis.insee")
DATASET_API = "https://www.data.gouv.fr/api/1/datasets/fichier-des-personnes-decedees/"


def db_path() -> Path:
    settings.ensure_dirs()
    return settings.data_dir / "insee_deces.db"


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(db_path())
    c.execute("""CREATE TABLE IF NOT EXISTS deces (
        id INTEGER PRIMARY KEY, nom TEXT, prenoms TEXT, nom_key TEXT, prenom_key TEXT, sexe TEXT, naissance TEXT,
        code_naissance TEXT, commune_naissance TEXT, pays_naissance TEXT, deces TEXT, code_deces TEXT, acte TEXT, fichier TEXT)""")
    c.execute("CREATE INDEX IF NOT EXISTS ix_deces_nom ON deces(nom_key)")
    c.execute("CREATE INDEX IF NOT EXISTS ix_deces_naiss ON deces(naissance)")
    c.execute("CREATE TABLE IF NOT EXISTS fichiers (nom TEXT PRIMARY KEY, lignes INTEGER, importe_le TEXT)")
    return c


def _key(s: str) -> str:
    return re.sub(r"[^a-z]", "", unidecode(s or "").lower())


def parse_line(line: str) -> Optional[dict]:
    if len(line) < 162:
        return None
    nom_pren = line[0:80]
    nom, _, rest = nom_pren.partition("*")
    prenoms = rest.split("/")[0].strip()
    sexe = {"1": "M", "2": "F"}.get(line[80], None)
    return {"nom": nom.strip(), "prenoms": prenoms, "nom_key": _key(nom), "prenom_key": _key(prenoms.split(" ")[0] if prenoms else ""),
            "sexe": sexe, "naissance": line[81:89].strip(), "code_naissance": line[89:94].strip(),
            "commune_naissance": line[94:124].strip(), "pays_naissance": line[124:154].strip(), "deces": line[154:162].strip(),
            "code_deces": line[162:167].strip(), "acte": line[167:176].strip() if len(line) >= 176 else ""}


def import_file(path: Path, *, log=None) -> int:
    """Importe un fichier annuel/mensuel. Retourne le nombre de lignes insérées."""
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    c = _conn()
    c.execute("DELETE FROM deces WHERE fichier=?", (path.name,))
    rows, n = [], 0
    for line in text.splitlines():
        rec = parse_line(line)
        if not rec:
            continue
        rows.append((rec["nom"], rec["prenoms"], rec["nom_key"], rec["prenom_key"], rec["sexe"], rec["naissance"], rec["code_naissance"],
                     rec["commune_naissance"], rec["pays_naissance"], rec["deces"], rec["code_deces"], rec["acte"], path.name))
        if len(rows) >= 20000:
            c.executemany("INSERT INTO deces(nom,prenoms,nom_key,prenom_key,sexe,naissance,code_naissance,commune_naissance,pays_naissance,deces,code_deces,acte,fichier) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
            n += len(rows)
            rows = []
            if log:
                log(n)
    if rows:
        c.executemany("INSERT INTO deces(nom,prenoms,nom_key,prenom_key,sexe,naissance,code_naissance,commune_naissance,pays_naissance,deces,code_deces,acte,fichier) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        n += len(rows)
    c.execute("INSERT OR REPLACE INTO fichiers(nom,lignes,importe_le) VALUES (?,?,?)", (path.name, n, datetime.now().isoformat()))
    c.commit()
    c.close()
    return n


def status() -> dict:
    if not db_path().exists():
        return {"files": [], "records": 0, "db_path": str(db_path())}
    c = _conn()
    files = [{"name": r[0], "lines": r[1], "imported_at": r[2]} for r in c.execute("SELECT nom, lignes, importe_le FROM fichiers ORDER BY nom")]
    total = c.execute("SELECT COUNT(*) FROM deces").fetchone()[0]
    c.close()
    return {"files": files, "records": total, "db_path": str(db_path())}


def _iso(s: str) -> Optional[str]:
    if not s or len(s) != 8 or s == "00000000":
        return None
    y, m, d = s[:4], s[4:6], s[6:]
    if m == "00":
        return y
    if d == "00":
        return f"{y}-{m}"
    return f"{y}-{m}-{d}"


def search_local(surname: str | None, given: str | None = None, birth_year: int | None = None, birth_date: str | None = None,
                 death_from: int | None = None, death_to: int | None = None, limit: int = 50) -> list[dict]:
    if not db_path().exists() or not surname:
        return []
    c = _conn()
    key = _key(surname)
    sql = "SELECT nom,prenoms,sexe,naissance,commune_naissance,pays_naissance,deces,code_deces,acte,fichier,code_naissance FROM deces WHERE nom_key=?"
    params: list = [key]
    if birth_date:
        sql += " AND naissance=?"
        params.append(birth_date.replace("-", ""))
    elif birth_year:
        sql += " AND naissance BETWEEN ? AND ?"
        params += [f"{birth_year - 1}0000", f"{birth_year + 1}9999"]
    if death_from:
        sql += " AND deces >= ?"
        params.append(f"{death_from}0000")
    if death_to:
        sql += " AND deces <= ?"
        params.append(f"{death_to}9999")
    if given:
        sql += " AND prenom_key LIKE ?"
        params.append(_key(given.split()[0]) + "%")
    sql += " LIMIT ?"
    params.append(limit)
    out = []
    for r in c.execute(sql, params):
        out.append({"nom": r[0], "prenoms": r[1], "sexe": r[2], "naissance": _iso(r[3]), "commune_naissance": r[4], "pays_naissance": r[5],
                    "deces": _iso(r[6]), "code_deces": r[7], "acte": r[8], "fichier": r[9], "code_naissance": r[10]})
    c.close()
    return out


class InseeLocalConnector(ArchiveConnector):
    capabilities = ConnectorCapabilities(
        id="insee_deces_local", name="Fichier des décès INSEE – index local (hors ligne)", country="FR",
        organization="INSEE (open data, data.gouv.fr)", collections=["Personnes décédées en France depuis 1970 (fichiers annuels importés localement)"],
        areas=["*"], period_start=1970, period_end=None, search_fields=["surname", "given_names", "birth_date", "year_from", "year_to"],
        access_mode="api", limitations=["Nécessite le téléchargement préalable des fichiers annuels (≈ 100 Mo par année)",
                                        "Décès survenus en France depuis 1970 uniquement", "Recherche strictement locale ensuite"],
        terms_url="https://www.data.gouv.fr/fr/datasets/fichier-des-personnes-decedees/", reuse_terms="Licence Ouverte 2.0 (Etalab) ; gratuit, sans clé",
        formats=["txt (largeur fixe)"], homepage="https://www.data.gouv.fr/fr/datasets/fichier-des-personnes-decedees/",
        notes="Aucun service tiers interrogé lors des recherches. " + UNVERIFIED,
    )
    min_interval = 0.0

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        birth_year = None
        if query.register_type == "death" and query.extra.get("birth_year"):
            birth_year = query.extra["birth_year"]
        rows = search_local(query.surname, query.given_names, birth_year=birth_year, birth_date=query.birth_date,
                            death_from=query.year_from, death_to=query.year_to)
        out = []
        for r in rows:
            by = int(r["naissance"][:4]) if r["naissance"] else None
            dy = int(r["deces"][:4]) if r["deces"] else None
            out.append(SearchResult(connector_id=self.id, title=f"{r['prenoms']} {r['nom']} ({r['naissance'] or '?'} – {r['deces'] or '?'})",
                                    url=self.capabilities.homepage,
                                    snippet=f"Né(e) à {r['commune_naissance'] or '?'} ({r['pays_naissance'] or 'France'}), décès code lieu {r['code_deces']}, acte n° {r['acte']} — fichier {r['fichier']}",
                                    record_type="death", year=dy, date_text=r["deces"], place=None, reference=f"{r['fichier']}#{r['acte']}",
                                    repository="INSEE (fichier des décès)", reliability="secondary",
                                    candidate={"surname": r["nom"], "given_names": r["prenoms"], "sex": r["sexe"], "birth_year": by,
                                               "birth_place": r["commune_naissance"], "death_year": dy, "event_year": dy, "extra": {"event_type": "death"}},
                                    raw=r, external_id=f"{r['fichier']}#{r['acte']}"))
        return out

    async def self_test(self) -> dict:
        st = status()
        ok = st["records"] > 0
        return {"ok": ok, "status": "ok" if ok else "degraded",
                "details": {**st, "message": "Index prêt" if ok else "Aucun fichier importé : téléchargez une année depuis Paramètres → Sources gratuites."}}

    async def list_resources(self) -> list[dict]:
        r = await self.fetch(DATASET_API, headers={"Accept": "application/json"}, timeout=30)
        if r.status_code != 200:
            raise RuntimeError(f"data.gouv.fr HTTP {r.status_code}")
        out = []
        for res in r.json().get("resources", []):
            title = res.get("title") or ""
            m = re.search(r"(\d{4})(?:-m(\d{2}))?", title)
            if not m or not title.lower().startswith("deces"):
                continue
            out.append({"title": title, "url": res.get("url"), "year": int(m.group(1)), "month": int(m.group(2)) if m.group(2) else None,
                        "size": res.get("filesize"), "format": res.get("format")})
        out.sort(key=lambda x: (-x["year"], x["month"] or 0))
        return out

    async def download(self, url: str, name: str, log=None) -> Path:
        import httpx

        dest = self.cache_dir / name
        async with httpx.AsyncClient(timeout=None, follow_redirects=True, headers={"User-Agent": settings.user_agent}) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status()
                total = int(resp.headers.get("content-length") or 0)
                done = 0
                with open(dest, "wb") as f:
                    async for chunk in resp.aiter_bytes(1 << 20):
                        f.write(chunk)
                        done += len(chunk)
                        if log and total:
                            log(done, total)
        return dest


registry.register(InseeLocalConnector())

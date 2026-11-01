"""Recherche plein texte : FTS5 sous SQLite, table simple + ILIKE sous PostgreSQL (portable)."""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine


def _is_sqlite(conn) -> bool:
    return conn.engine.dialect.name == "sqlite"


def ensure_fts(engine: Engine) -> None:
    with engine.begin() as conn:
        if engine.dialect.name == "sqlite":
            conn.execute(text(
                "CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5("
                "entity_type UNINDEXED, entity_id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2')"
            ))
        else:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS fts_index (entity_type VARCHAR(16) NOT NULL, entity_id VARCHAR(32) NOT NULL, "
                "title TEXT, body TEXT, PRIMARY KEY (entity_type, entity_id))"
            ))


def index_entity(conn, entity_type: str, entity_id: str, title: str, body: str) -> None:
    conn.execute(text("DELETE FROM fts_index WHERE entity_type=:t AND entity_id=:i"), {"t": entity_type, "i": entity_id})
    conn.execute(text("INSERT INTO fts_index(entity_type, entity_id, title, body) VALUES (:t,:i,:ti,:b)"),
                 {"t": entity_type, "i": entity_id, "ti": title or "", "b": body or ""})


def remove_entity(conn, entity_type: str, entity_id: str) -> None:
    conn.execute(text("DELETE FROM fts_index WHERE entity_type=:t AND entity_id=:i"), {"t": entity_type, "i": entity_id})


def _fts_query(q: str) -> str:
    tokens = [t for t in q.replace('"', " ").split() if t]
    return " ".join(f'"{t}"*' for t in tokens)


def search(conn, q: str, limit: int = 30, entity_type: str | None = None) -> list[dict]:
    if not q.strip():
        return []
    if _is_sqlite(conn):
        sql = ("SELECT entity_type, entity_id, title, snippet(fts_index, 3, '[', ']', '…', 12) AS snippet, "
               "bm25(fts_index) AS rank FROM fts_index WHERE fts_index MATCH :q")
        params: dict = {"q": _fts_query(q), "lim": limit}
        if entity_type:
            sql += " AND entity_type=:et"
            params["et"] = entity_type
        sql += " ORDER BY rank LIMIT :lim"
        return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]
    # PostgreSQL : correspondance insensible à la casse et aux accents (unaccent si disponible)
    from unidecode import unidecode

    tokens = [unidecode(t).lower() for t in q.split() if t]
    where = " AND ".join(f"(lower(title) LIKE :t{i} OR lower(body) LIKE :t{i})" for i in range(len(tokens)))
    params = {f"t{i}": f"%{t}%" for i, t in enumerate(tokens)}
    params["lim"] = limit
    sql = f"SELECT entity_type, entity_id, title, substr(body, 1, 160) AS snippet, 0 AS rank FROM fts_index WHERE {where}"
    if entity_type:
        sql += " AND entity_type=:et"
        params["et"] = entity_type
    sql += " LIMIT :lim"
    rows = [dict(r) for r in conn.execute(text(sql), params).mappings().all()]
    # Repli sans accents : on compare côté Python si rien n'est trouvé (petites bases)
    if not rows:
        all_rows = conn.execute(text("SELECT entity_type, entity_id, title, body FROM fts_index" + (" WHERE entity_type=:et" if entity_type else "")),
                                {"et": entity_type} if entity_type else {}).mappings().all()
        for r in all_rows:
            hay = unidecode(f"{r['title']} {r['body']}").lower()
            if all(t in hay for t in tokens):
                rows.append({"entity_type": r["entity_type"], "entity_id": r["entity_id"], "title": r["title"],
                             "snippet": (r["body"] or "")[:160], "rank": 0})
                if len(rows) >= limit:
                    break
    return rows

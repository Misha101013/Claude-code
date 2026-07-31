"""Хранилище на SQLite: лиды, антидубли, настройки, статистика по чатам."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Iterable, Sequence

import aiosqlite

from .models import Lead

SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint   TEXT UNIQUE,
    simhash       INTEGER NOT NULL DEFAULT 0,
    source        TEXT NOT NULL,
    chat_id       INTEGER,
    chat_title    TEXT,
    chat_username TEXT,
    message_id    INTEGER,
    author_id     INTEGER,
    author_username TEXT,
    author_name   TEXT,
    text          TEXT NOT NULL,
    url           TEXT,
    score         INTEGER NOT NULL,
    category      TEXT,
    budget_kzt    INTEGER,
    city          TEXT,
    contacts      TEXT,
    urgent        INTEGER NOT NULL DEFAULT 0,
    matched       TEXT,
    ai_is_order   INTEGER,
    ai_confidence REAL,
    ai_reason     TEXT,
    seen_count    INTEGER NOT NULL DEFAULT 1,
    status        TEXT NOT NULL DEFAULT 'new',
    created_at    REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_status  ON leads(status);

CREATE TABLE IF NOT EXISTS seen (
    fingerprint TEXT PRIMARY KEY,
    simhash     INTEGER NOT NULL DEFAULT 0,
    lead_id     INTEGER,
    hits        INTEGER NOT NULL DEFAULT 1,
    first_seen  REAL NOT NULL,
    last_seen   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seen_last ON seen(last_seen);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS keyword_edits (
    grp    TEXT NOT NULL,
    phrase TEXT NOT NULL,
    added  INTEGER NOT NULL,
    PRIMARY KEY (grp, phrase)
);

CREATE TABLE IF NOT EXISTS chat_stats (
    chat_id   INTEGER PRIMARY KEY,
    title     TEXT,
    username  TEXT,
    scanned   INTEGER NOT NULL DEFAULT 0,
    leads     INTEGER NOT NULL DEFAULT 0,
    useful    INTEGER NOT NULL DEFAULT 0,
    junk      INTEGER NOT NULL DEFAULT 0,
    last_seen REAL
);

CREATE TABLE IF NOT EXISTS bans (
    kind  TEXT NOT NULL,   -- 'chat' | 'author'
    value INTEGER NOT NULL,
    title TEXT,
    added_at REAL NOT NULL,
    PRIMARY KEY (kind, value)
);

CREATE TABLE IF NOT EXISTS cursors (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class Storage:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._db: aiosqlite.Connection | None = None

    # ------------------------------------------------------------------ жизненный цикл
    async def open(self) -> "Storage":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = await aiosqlite.connect(self.path)
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(SCHEMA)
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.commit()
        return self

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    @property
    def db(self) -> aiosqlite.Connection:
        if self._db is None:
            raise RuntimeError("Storage.open() не был вызван")
        return self._db

    async def __aenter__(self) -> "Storage":
        return await self.open()

    async def __aexit__(self, *_exc: object) -> None:
        await self.close()

    # ------------------------------------------------------------------ настройки
    async def load_settings(self) -> dict[str, Any]:
        rows = await self.db.execute_fetchall("SELECT key, value FROM settings")
        result: dict[str, Any] = {}
        for row in rows:
            try:
                result[row["key"]] = json.loads(row["value"])
            except json.JSONDecodeError:
                result[row["key"]] = row["value"]
        return result

    async def save_setting(self, key: str, value: Any) -> None:
        await self.db.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value, ensure_ascii=False)),
        )
        await self.db.commit()

    # ------------------------------------------------------- ключевые слова
    async def load_keyword_edits(self) -> list[tuple[str, str, bool]]:
        rows = await self.db.execute_fetchall(
            "SELECT grp, phrase, added FROM keyword_edits"
        )
        return [(row["grp"], row["phrase"], bool(row["added"])) for row in rows]

    async def save_keyword_edit(self, group: str, phrase: str, added: bool) -> None:
        await self.db.execute(
            "INSERT INTO keyword_edits(grp, phrase, added) VALUES(?, ?, ?) "
            "ON CONFLICT(grp, phrase) DO UPDATE SET added=excluded.added",
            (group, phrase, int(added)),
        )
        await self.db.commit()

    # ------------------------------------------------------------- антидубли
    async def recent_hashes(self, window_hours: float, limit: int = 5000):
        """Отпечатки за последние N часов — материал для дедупа."""
        since = time.time() - window_hours * 3600
        return await self.db.execute_fetchall(
            "SELECT fingerprint, simhash, lead_id FROM seen "
            "WHERE last_seen >= ? ORDER BY last_seen DESC LIMIT ?",
            (since, limit),
        )

    async def find_seen(self, fingerprint: str) -> aiosqlite.Row | None:
        cursor = await self.db.execute(
            "SELECT * FROM seen WHERE fingerprint = ?", (fingerprint,)
        )
        return await cursor.fetchone()

    async def remember(
        self, fingerprint: str, simhash: int, lead_id: int | None = None
    ) -> int:
        """Записывает отпечаток. Возвращает, сколько раз текст уже встречался."""
        now = time.time()
        await self.db.execute(
            "INSERT INTO seen(fingerprint, simhash, lead_id, hits, first_seen, last_seen) "
            "VALUES(?, ?, ?, 1, ?, ?) "
            "ON CONFLICT(fingerprint) DO UPDATE SET "
            "  hits = hits + 1, last_seen = excluded.last_seen, "
            "  lead_id = COALESCE(seen.lead_id, excluded.lead_id)",
            (fingerprint, simhash, lead_id, now, now),
        )
        await self.db.commit()
        row = await self.find_seen(fingerprint)
        return int(row["hits"]) if row else 1

    async def bump_duplicate(self, lead_id: int) -> int:
        await self.db.execute(
            "UPDATE leads SET seen_count = seen_count + 1 WHERE id = ?", (lead_id,)
        )
        await self.db.commit()
        cursor = await self.db.execute(
            "SELECT seen_count FROM leads WHERE id = ?", (lead_id,)
        )
        row = await cursor.fetchone()
        return int(row["seen_count"]) if row else 1

    # ------------------------------------------------------------------ лиды
    async def save_lead(self, lead: Lead) -> int:
        item = lead.item
        await self.db.execute(
            """INSERT INTO leads(
                fingerprint, simhash, source, chat_id, chat_title, chat_username,
                message_id, author_id, author_username, author_name, text, url,
                score, category, budget_kzt, city, contacts, urgent, matched,
                ai_is_order, ai_confidence, ai_reason, seen_count, status, created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(fingerprint) DO UPDATE SET seen_count = leads.seen_count + 1""",
            (
                lead.fingerprint,
                lead.simhash,
                item.source,
                item.chat_id,
                item.chat_title,
                item.chat_username,
                item.message_id,
                item.author_id,
                item.author_username,
                item.author_name,
                item.text,
                item.link,
                lead.score,
                lead.category,
                lead.budget_kzt,
                lead.rules.city,
                json.dumps(lead.rules.contacts, ensure_ascii=False),
                int(lead.rules.urgent),
                json.dumps(lead.rules.matched, ensure_ascii=False),
                None if lead.ai is None else int(lead.ai.is_order),
                None if lead.ai is None else lead.ai.confidence,
                None if lead.ai is None else lead.ai.reason,
                lead.seen_count,
                "new",
                item.date or time.time(),
            ),
        )
        await self.db.commit()
        # lastrowid не годится: при ON CONFLICT DO UPDATE он не обновляется,
        # поэтому id всегда берём по отпечатку.
        cursor = await self.db.execute(
            "SELECT id FROM leads WHERE fingerprint = ?", (lead.fingerprint,)
        )
        found = await cursor.fetchone()
        lead.id = int(found["id"]) if found else 0
        return lead.id

    async def set_lead_status(self, lead_id: int, status: str) -> None:
        await self.db.execute(
            "UPDATE leads SET status = ? WHERE id = ?", (status, lead_id)
        )
        await self.db.commit()

    async def get_lead(self, lead_id: int) -> aiosqlite.Row | None:
        cursor = await self.db.execute("SELECT * FROM leads WHERE id = ?", (lead_id,))
        return await cursor.fetchone()

    async def leads_since(self, since: float) -> Sequence[aiosqlite.Row]:
        return await self.db.execute_fetchall(
            "SELECT * FROM leads WHERE created_at >= ? ORDER BY created_at DESC",
            (since,),
        )

    async def count_leads_since(self, since: float) -> int:
        cursor = await self.db.execute(
            "SELECT COUNT(*) AS n FROM leads WHERE created_at >= ?", (since,)
        )
        row = await cursor.fetchone()
        return int(row["n"]) if row else 0

    # ------------------------------------------------------- статистика чатов
    async def touch_chat(
        self,
        chat_id: int | None,
        title: str = "",
        username: str | None = None,
        *,
        scanned: int = 0,
        leads: int = 0,
        useful: int = 0,
        junk: int = 0,
    ) -> None:
        if not chat_id:
            return
        await self.db.execute(
            "INSERT INTO chat_stats(chat_id, title, username, scanned, leads, useful, junk, last_seen) "
            "VALUES(?,?,?,?,?,?,?,?) "
            "ON CONFLICT(chat_id) DO UPDATE SET "
            "  title = COALESCE(NULLIF(excluded.title, ''), chat_stats.title), "
            "  username = COALESCE(excluded.username, chat_stats.username), "
            "  scanned = chat_stats.scanned + excluded.scanned, "
            "  leads = chat_stats.leads + excluded.leads, "
            "  useful = chat_stats.useful + excluded.useful, "
            "  junk = chat_stats.junk + excluded.junk, "
            "  last_seen = excluded.last_seen",
            (chat_id, title, username, scanned, leads, useful, junk, time.time()),
        )
        await self.db.commit()

    async def top_chats(self, limit: int = 10) -> Sequence[aiosqlite.Row]:
        return await self.db.execute_fetchall(
            "SELECT * FROM chat_stats ORDER BY leads DESC, scanned DESC LIMIT ?",
            (limit,),
        )

    # ------------------------------------------------------------------ баны
    async def ban(self, kind: str, value: int, title: str = "") -> None:
        await self.db.execute(
            "INSERT OR REPLACE INTO bans(kind, value, title, added_at) VALUES(?,?,?,?)",
            (kind, value, title, time.time()),
        )
        await self.db.commit()

    async def unban(self, kind: str, value: int) -> None:
        await self.db.execute(
            "DELETE FROM bans WHERE kind = ? AND value = ?", (kind, value)
        )
        await self.db.commit()

    async def load_bans(self) -> dict[str, set[int]]:
        rows = await self.db.execute_fetchall("SELECT kind, value FROM bans")
        result: dict[str, set[int]] = {"chat": set(), "author": set()}
        for row in rows:
            result.setdefault(row["kind"], set()).add(int(row["value"]))
        return result

    async def banned_list(self, kind: str) -> Sequence[aiosqlite.Row]:
        return await self.db.execute_fetchall(
            "SELECT value, title FROM bans WHERE kind = ? ORDER BY added_at DESC",
            (kind,),
        )

    # --------------------------------------------------------------- курсоры
    async def get_cursor(self, key: str) -> str | None:
        cursor = await self.db.execute("SELECT value FROM cursors WHERE key = ?", (key,))
        row = await cursor.fetchone()
        return row["value"] if row else None

    async def set_cursor(self, key: str, value: str) -> None:
        await self.db.execute(
            "INSERT INTO cursors(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        await self.db.commit()

    # ----------------------------------------------------------------- экспорт
    async def export_csv(self, path: str | Path, since: float | None = None) -> Path:
        import csv

        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        rows = await self.leads_since(since or 0.0)
        columns = [
            "created_at", "score", "category", "budget_kzt", "city", "urgent",
            "chat_title", "author_username", "contacts", "url", "text",
        ]
        with path.open("w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.writer(fh, delimiter=";")
            writer.writerow(columns)
            for row in rows:
                writer.writerow([_csv_value(row, column) for column in columns])
        return path


def _csv_value(row: aiosqlite.Row, column: str) -> Any:
    value = row[column]
    if column == "created_at" and value:
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(float(value)))
    if column == "text" and isinstance(value, str):
        return value.replace("\n", " ").strip()
    return value


def rows_to_dicts(rows: Iterable[aiosqlite.Row]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]

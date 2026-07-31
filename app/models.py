"""Структуры данных, которые ходят по пайплайну."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class RawItem:
    """Сообщение из любого источника, приведённое к общему виду.

    Telegram, глобальный поиск и внешние биржи создают именно его — дальше
    пайплайн ничего не знает о происхождении текста.
    """

    source: str  # "telegram" | "tg_search" | "kwork" | ...
    text: str
    chat_id: int | None = None
    chat_title: str = ""
    chat_username: str | None = None
    message_id: int | None = None
    author_id: int | None = None
    author_username: str | None = None
    author_name: str = ""
    date: float = field(default_factory=time.time)
    url: str | None = None
    is_channel: bool = False
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def link(self) -> str | None:
        """Ссылка на исходное сообщение."""
        if self.url:
            return self.url
        if self.chat_username and self.message_id:
            return f"https://t.me/{self.chat_username}/{self.message_id}"
        if self.chat_id and self.message_id:
            # Приватные супергруппы: -100xxxxxxxxxx -> t.me/c/xxxxxxxxxx
            raw = str(self.chat_id)
            if raw.startswith("-100"):
                return f"https://t.me/c/{raw[4:]}/{self.message_id}"
        return None

    @property
    def source_title(self) -> str:
        return self.chat_title or self.chat_username or self.source


@dataclass(slots=True)
class RuleResult:
    """Итог работы слоя правил."""

    score: int = 0
    rejected: bool = False
    reject_reason: str = ""
    matched: dict[str, list[str]] = field(default_factory=dict)
    budget_kzt: int | None = None
    budget_raw: str | None = None
    city: str | None = None
    contacts: list[str] = field(default_factory=list)
    urgent: bool = False

    def add(self, group: str, phrase: str) -> None:
        self.matched.setdefault(group, []).append(phrase)

    def hits(self, group: str) -> int:
        return len(self.matched.get(group, ()))

    def explain(self) -> str:
        parts = []
        for group, phrases in self.matched.items():
            uniq = list(dict.fromkeys(phrases))[:4]
            parts.append(f"{group}: {', '.join(uniq)}")
        return "; ".join(parts)


@dataclass(slots=True)
class AIVerdict:
    """Ответ Gemini."""

    is_order: bool
    confidence: float = 0.0
    category: str = ""
    budget_kzt: int | None = None
    urgency: str = ""
    geo_kz: bool | None = None
    reason: str = ""
    from_cache: bool = False
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


@dataclass(slots=True)
class Lead:
    """Готовый лид — то, что уходит владельцу и пишется в БД."""

    item: RawItem
    score: int
    rules: RuleResult
    ai: AIVerdict | None = None
    fingerprint: str = ""
    simhash: int = 0
    seen_count: int = 1
    id: int | None = None

    @property
    def budget_kzt(self) -> int | None:
        if self.rules.budget_kzt:
            return self.rules.budget_kzt
        return self.ai.budget_kzt if self.ai else None

    @property
    def category(self) -> str:
        if self.ai and self.ai.category:
            return self.ai.category
        topics = self.rules.matched.get("topic") or []
        return topics[0] if topics else "сайт"

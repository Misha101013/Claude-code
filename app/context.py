"""Общий контекст приложения: связывает конфиг, БД, фильтры и источники.

Нужен, чтобы бот-панель управления мог менять настройки на лету, а пайплайн
и источники сразу видели изменения (никаких перезапусков).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from .config import Config, Secrets
from .filters.gemini import GeminiClassifier
from .filters.rules import RuleEngine
from .pipeline import Pipeline
from .storage import Storage


@dataclass
class AppContext:
    secrets: Secrets
    config: Config
    storage: Storage
    rules: RuleEngine
    classifier: GeminiClassifier
    pipeline: Pipeline
    notifier: Any | None = None
    telegram: Any | None = None  # TelegramSource, импорт ленивый из-за telethon
    sink: Any | None = None
    started_at: float = field(default_factory=time.time)

    # ------------------------------------------------------------------
    async def set_setting(self, key: str, value: Any) -> Any:
        """Меняет настройку и сохраняет её, чтобы пережила перезапуск."""
        casted = self.config.set_override(key, value)
        await self.storage.save_setting(key, casted)
        self._after_config_change(key)
        return casted

    async def edit_keyword(self, group: str, phrase: str, *, add: bool) -> None:
        self.config.edit_keyword(group, phrase, add=add)
        await self.storage.save_keyword_edit(group, phrase, add)
        self.rules.rebuild()

    async def reload_config(self) -> None:
        """Перечитать YAML с диска, сохранив правки из бота."""
        self.config.reload()
        self.config.apply_overrides(await self.storage.load_settings())
        self.config.apply_keyword_edits(await self.storage.load_keyword_edits())
        self.rules.rebuild()

    async def refresh_bans(self) -> None:
        self.pipeline.bans = await self.storage.load_bans()

    def _after_config_change(self, key: str) -> None:
        if key.startswith("scoring.") or key.startswith("rules."):
            self.rules.rebuild()
        if key.startswith("dedup."):
            self.pipeline.dedup.window_hours = float(
                self.config.get("dedup.window_hours", 72) or 72
            )

    @property
    def uptime_seconds(self) -> float:
        return time.time() - self.started_at

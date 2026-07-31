"""Конфигурация: секреты из окружения + правила из YAML + правки из БД.

Разделение намеренное:
  * `.env`      — только секреты, их нельзя менять на лету;
  * `config.yaml` — правила и пороги, значения по умолчанию;
  * БД          — правки, сделанные из бота (`/ai`, `/threshold`, `/keywords`),
                  они накладываются поверх YAML и переживают перезапуск.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import yaml

# Ключи, которые разрешено менять из бота. Всё остальное — только через YAML,
# чтобы случайной командой нельзя было сломать логику скоринга.
MUTABLE_KEYS: dict[str, type] = {
    "ai.mode": str,
    "ai.model": str,
    "ai.daily_limit": int,
    "ai.min_confidence": float,
    "scoring.notify_threshold": int,
    "scoring.reject_below": int,
    "scoring.ai_low": int,
    "scoring.ai_high": int,
    "telegram.global_search.enabled": bool,
    "telegram.global_search.interval_minutes": int,
    "external.enabled": bool,
    "notify.show_debug": bool,
    "paused": bool,
}

# Группы правил, которые можно пополнять из бота командой /keywords.
KEYWORD_GROUPS = (
    "topic",
    "intent",
    "offer_anti",
    "geo",
    "foreign",
    "stop",
    "urgency",
)

AI_MODES = ("off", "grey_zone", "all")


@dataclass(slots=True)
class Secrets:
    """Значения из окружения. Отсутствующие поля — не ошибка на этапе загрузки:
    режимы `--dry-run` и тесты работают вообще без Telegram и Gemini."""

    tg_api_id: int | None = None
    tg_api_hash: str | None = None
    tg_phone: str | None = None
    tg_password: str | None = None
    bot_token: str | None = None
    owner_id: int | None = None
    gemini_api_key: str | None = None
    config_path: Path = Path("config.yaml")
    data_dir: Path = Path("data")
    log_level: str = "INFO"

    @property
    def session_path(self) -> Path:
        return self.data_dir / "userbot.session"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "leads.db"

    def require_telegram(self) -> None:
        missing = [
            name
            for name, value in (
                ("TG_API_ID", self.tg_api_id),
                ("TG_API_HASH", self.tg_api_hash),
                ("TG_PHONE", self.tg_phone),
                ("BOT_TOKEN", self.bot_token),
                ("OWNER_ID", self.owner_id),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(
                "Не заполнены переменные окружения: "
                + ", ".join(missing)
                + ". Скопируйте .env.example в .env и заполните его."
            )


def _env_int(name: str) -> int | None:
    raw = os.getenv(name, "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError as exc:  # понятная ошибка вместо стектрейса при старте
        raise RuntimeError(f"{name} должен быть числом, получено: {raw!r}") from exc


def load_secrets(env_file: str | os.PathLike[str] | None = ".env") -> Secrets:
    """Читает `.env` (если есть) и переменные окружения."""
    if env_file and Path(env_file).exists():
        try:
            from dotenv import load_dotenv

            load_dotenv(env_file, override=False)
        except ImportError:  # python-dotenv не обязателен, если env уже задан
            _load_env_file_manually(Path(env_file))

    return Secrets(
        tg_api_id=_env_int("TG_API_ID"),
        tg_api_hash=os.getenv("TG_API_HASH") or None,
        tg_phone=os.getenv("TG_PHONE") or None,
        tg_password=os.getenv("TG_PASSWORD") or None,
        bot_token=os.getenv("BOT_TOKEN") or None,
        owner_id=_env_int("OWNER_ID"),
        gemini_api_key=os.getenv("GEMINI_API_KEY") or None,
        config_path=Path(os.getenv("CONFIG_PATH") or "config.yaml"),
        data_dir=Path(os.getenv("DATA_DIR") or "data"),
        log_level=(os.getenv("LOG_LEVEL") or "INFO").upper(),
    )


def _load_env_file_manually(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


class Config:
    """Дерево настроек с точечным доступом и оверрайдами из БД."""

    def __init__(
        self,
        data: dict[str, Any],
        *,
        path: Path | None = None,
        overrides: dict[str, Any] | None = None,
        keyword_edits: Iterable[tuple[str, str, bool]] = (),
    ) -> None:
        self._data = data or {}
        self._path = path
        self._overrides: dict[str, Any] = dict(overrides or {})
        # (group, phrase) -> True (добавлено) / False (удалено)
        self._keyword_edits: dict[tuple[str, str], bool] = {}
        for group, phrase, added in keyword_edits:
            self._keyword_edits[(group, phrase)] = added

    # ------------------------------------------------------------------ IO
    @classmethod
    def load(cls, path: str | os.PathLike[str]) -> "Config":
        path = Path(path)
        if not path.exists():
            example = path.with_name("config.example.yaml")
            if example.exists():
                path = example
            else:
                raise FileNotFoundError(
                    f"Не найден {path}. Скопируйте config.example.yaml в config.yaml."
                )
        with path.open(encoding="utf-8") as fh:
            return cls(yaml.safe_load(fh) or {}, path=path)

    def reload(self) -> None:
        """Перечитать YAML с диска, сохранив оверрайды из БД."""
        if not self._path:
            return
        with self._path.open(encoding="utf-8") as fh:
            self._data = yaml.safe_load(fh) or {}

    # --------------------------------------------------------------- Доступ
    def get(self, path: str, default: Any = None) -> Any:
        if path in self._overrides:
            return self._overrides[path]
        node: Any = self._data
        for part in path.split("."):
            if not isinstance(node, dict) or part not in node:
                return default
            node = node[part]
        return node

    def section(self, path: str) -> dict[str, Any]:
        value = self.get(path, {})
        return value if isinstance(value, dict) else {}

    # ----------------------------------------------------------- Оверрайды
    def set_override(self, path: str, value: Any) -> Any:
        """Меняет значение на лету. Возвращает приведённое значение."""
        if path not in MUTABLE_KEYS:
            raise KeyError(f"Настройка {path} не редактируется из бота")
        casted = _cast(value, MUTABLE_KEYS[path])
        if path == "ai.mode" and casted not in AI_MODES:
            raise ValueError(f"ai.mode должен быть одним из {AI_MODES}")
        self._overrides[path] = casted
        return casted

    def overrides(self) -> dict[str, Any]:
        return dict(self._overrides)

    def apply_overrides(self, overrides: dict[str, Any]) -> None:
        for key, value in overrides.items():
            if key in MUTABLE_KEYS:
                try:
                    self._overrides[key] = _cast(value, MUTABLE_KEYS[key])
                except (TypeError, ValueError):
                    continue

    # ------------------------------------------------------- Ключевые слова
    def keywords(self, group: str) -> list[str]:
        """YAML-список группы + добавленное из бота − удалённое из бота."""
        base = self.get(f"rules.{group}", []) or []
        result = [str(item) for item in base]
        lowered = {item.lower() for item in result}
        for (edit_group, phrase), added in self._keyword_edits.items():
            if edit_group != group:
                continue
            if added:
                if phrase.lower() not in lowered:
                    result.append(phrase)
                    lowered.add(phrase.lower())
            else:
                result = [item for item in result if item.lower() != phrase.lower()]
                lowered.discard(phrase.lower())
        return result

    def edit_keyword(self, group: str, phrase: str, *, add: bool) -> None:
        if group not in KEYWORD_GROUPS:
            raise KeyError(f"Неизвестная группа правил: {group}")
        self._keyword_edits[(group, phrase.strip())] = add

    def keyword_edits(self) -> list[tuple[str, str, bool]]:
        return [(g, p, a) for (g, p), a in self._keyword_edits.items()]

    def apply_keyword_edits(self, edits: Iterable[tuple[str, str, bool]]) -> None:
        for group, phrase, added in edits:
            if group in KEYWORD_GROUPS:
                self._keyword_edits[(group, phrase)] = added

    # --------------------------------------------------------------- Прочее
    @property
    def paused(self) -> bool:
        return bool(self.get("paused", False))


def _cast(value: Any, target: type) -> Any:
    if target is bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "on", "yes", "да", "вкл"}
    if target is int:
        return int(float(value))
    if target is float:
        return float(value)
    return str(value)


@dataclass(slots=True)
class RuntimeState:
    """Изменяемое состояние процесса, которое не относится к настройкам."""

    ai_calls_today: int = 0
    ai_calls_date: str = ""
    started_at: float = 0.0
    counters: dict[str, int] = field(default_factory=dict)

    def bump(self, name: str, amount: int = 1) -> None:
        self.counters[name] = self.counters.get(name, 0) + amount

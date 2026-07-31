"""Telegram-юзербот: живой поток, догон истории и глобальный поиск.

Юзербот видит всё, что видит ваш аккаунт: любые группы и каналы, куда вы
вступили, — в отличие от обычного бота, которого в чужие чаты не пустят.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Iterable

from telethon import TelegramClient, events
from telethon.errors import FloodWaitError, RPCError
from telethon.tl.types import Channel, Chat, User

from ..config import Config
from ..models import RawItem
from ..storage import Storage
from .base import ItemSink

log = logging.getLogger(__name__)


def build_client(
    session: str, api_id: int, api_hash: str, *, device: str = "kz-web-leads"
) -> TelegramClient:
    return TelegramClient(
        session,
        api_id,
        api_hash,
        device_model=device,
        system_version="1.0",
        app_version="1.0",
        # Спокойные настройки: агрессивный парсинг — путь к ограничению аккаунта.
        flood_sleep_threshold=120,
    )


def _chat_meta(chat: Any) -> tuple[int | None, str, str | None, bool]:
    """(chat_id, заголовок, username, это_канал)."""
    if chat is None:
        return None, "", None, False
    chat_id = getattr(chat, "id", None)
    username = getattr(chat, "username", None)
    if isinstance(chat, Channel):
        broadcast = bool(getattr(chat, "broadcast", False))
        return chat_id, getattr(chat, "title", "") or "", username, broadcast
    if isinstance(chat, Chat):
        return chat_id, getattr(chat, "title", "") or "", username, False
    if isinstance(chat, User):
        name = " ".join(
            part for part in (chat.first_name, chat.last_name) if part
        ).strip()
        return chat_id, name or (username or ""), username, False
    return chat_id, getattr(chat, "title", "") or "", username, False


def _author_meta(sender: Any) -> tuple[int | None, str | None, str]:
    if sender is None:
        return None, None, ""
    name = " ".join(
        part
        for part in (
            getattr(sender, "first_name", None),
            getattr(sender, "last_name", None),
        )
        if part
    ).strip()
    if not name:
        name = getattr(sender, "title", "") or ""
    return getattr(sender, "id", None), getattr(sender, "username", None), name


class TelegramSource:
    """Живой поток + бэкфилл + глобальный поиск на одном клиенте."""

    def __init__(
        self,
        client: TelegramClient,
        config: Config,
        sink: ItemSink,
        storage: Storage | None = None,
    ) -> None:
        self.client = client
        self.config = config
        self.sink = sink
        self.storage = storage
        self.stats = {"live": 0, "backfill": 0, "search": 0, "skipped": 0}

    # ------------------------------------------------------------- фильтры
    def _allowed_chat(self, chat_id: int | None, username: str | None) -> bool:
        whitelist = self.config.get("telegram.chat_whitelist", []) or []
        blacklist = self.config.get("telegram.chat_blacklist", []) or []
        if _in_list(blacklist, chat_id, username):
            return False
        if whitelist:
            return _in_list(whitelist, chat_id, username)
        return True

    # --------------------------------------------------------- живой поток
    def register_live(self) -> None:
        @self.client.on(events.NewMessage(incoming=True))
        async def handler(event: events.NewMessage.Event) -> None:  # noqa: ANN202
            try:
                await self._handle_live(event)
            except Exception:  # noqa: BLE001 — обработчик не должен падать
                log.exception("Ошибка обработки сообщения")

        log.info("Слушаю новые сообщения во всех чатах аккаунта")

    async def _handle_live(self, event: events.NewMessage.Event) -> None:
        if self.config.paused:
            return
        message = event.message
        text = (message.message or "").strip()
        if not text:
            return
        if self.config.get("telegram.skip_outgoing", True) and message.out:
            return
        if self.config.get("telegram.skip_private", True) and event.is_private:
            return

        chat = await event.get_chat()
        chat_id, title, username, is_channel = _chat_meta(chat)
        if not self._allowed_chat(chat_id, username):
            self.stats["skipped"] += 1
            return

        sender = await event.get_sender()
        author_id, author_username, author_name = _author_meta(sender)

        self.stats["live"] += 1
        await self.sink.put(
            RawItem(
                source="telegram",
                text=text,
                chat_id=_full_chat_id(chat_id, is_channel or isinstance(chat, Channel)),
                chat_title=title,
                chat_username=username,
                message_id=message.id,
                author_id=author_id,
                author_username=author_username,
                author_name=author_name,
                date=message.date.timestamp() if message.date else time.time(),
                is_channel=is_channel,
            )
        )

    # ------------------------------------------------------------ бэкфилл
    async def backfill(self) -> int:
        """Разобрать историю чатов за последние N дней (один раз при старте)."""
        cfg = self.config.section("telegram.backfill")
        if not cfg.get("enabled", True):
            return 0
        days = float(cfg.get("days", 3) or 3)
        per_chat = int(cfg.get("per_chat_limit", 150) or 150)
        max_chats = int(cfg.get("max_chats", 150) or 150)
        delay = float(cfg.get("delay_seconds", 1.5) or 0)
        since = time.time() - days * 86400

        if self.storage is not None:
            last = await self.storage.get_cursor("backfill_at")
            if last and time.time() - float(last) < days * 86400 / 2:
                log.info("Бэкфилл недавно выполнялся, пропускаю")
                return 0

        processed = 0
        chats = 0
        async for dialog in self.client.iter_dialogs(limit=max_chats * 2):
            if chats >= max_chats:
                break
            entity = dialog.entity
            chat_id, title, username, is_channel = _chat_meta(entity)
            if isinstance(entity, User):
                continue
            if not self._allowed_chat(chat_id, username):
                continue
            chats += 1
            try:
                processed += await self._backfill_chat(
                    dialog, since, per_chat, chat_id, title, username, is_channel
                )
            except FloodWaitError as exc:
                log.warning("FloodWait %s сек на бэкфилле, пауза", exc.seconds)
                await asyncio.sleep(min(exc.seconds + 1, 300))
            except RPCError as exc:
                log.warning("Не смог прочитать историю %s: %s", title or chat_id, exc)
            if delay:
                await asyncio.sleep(delay)

        if self.storage is not None:
            await self.storage.set_cursor("backfill_at", str(time.time()))
        log.info("Бэкфилл завершён: %s чатов, %s сообщений", chats, processed)
        return processed

    async def _backfill_chat(
        self,
        dialog: Any,
        since: float,
        limit: int,
        chat_id: int | None,
        title: str,
        username: str | None,
        is_channel: bool,
    ) -> int:
        count = 0
        async for message in self.client.iter_messages(dialog.entity, limit=limit):
            if not message.date or message.date.timestamp() < since:
                break
            text = (message.message or "").strip()
            if not text:
                continue
            author_id, author_username, author_name = _author_meta(
                await message.get_sender()
            )
            self.stats["backfill"] += 1
            count += 1
            await self.sink.put(
                RawItem(
                    source="telegram_backfill",
                    text=text,
                    chat_id=_full_chat_id(chat_id, is_channel),
                    chat_title=title,
                    chat_username=username,
                    message_id=message.id,
                    author_id=author_id,
                    author_username=author_username,
                    author_name=author_name,
                    date=message.date.timestamp(),
                    is_channel=is_channel,
                )
            )
        return count

    # ---------------------------------------------------- глобальный поиск
    async def global_search(self) -> int:
        """Поиск по всему Telegram, включая чаты, где вас нет."""
        cfg = self.config.section("telegram.global_search")
        if not self.config.get("telegram.global_search.enabled", cfg.get("enabled", True)):
            return 0
        queries: Iterable[str] = cfg.get("queries", []) or []
        limit = int(cfg.get("limit_per_query", 40) or 40)
        delay = float(cfg.get("delay_seconds", 4.0) or 0)
        found = 0

        for query in queries:
            if self.config.paused:
                break
            try:
                found += await self._search_one(query, limit)
            except FloodWaitError as exc:
                log.warning("FloodWait %s сек на поиске, пауза", exc.seconds)
                await asyncio.sleep(min(exc.seconds + 1, 300))
            except RPCError as exc:
                log.warning("Поиск «%s» не удался: %s", query, exc)
            if delay:
                await asyncio.sleep(delay)

        log.info("Глобальный поиск: %s сообщений в очереди", found)
        return found

    async def _search_one(self, query: str, limit: int) -> int:
        count = 0
        # peer=None в Telethon означает глобальный поиск по всем чатам.
        async for message in self.client.iter_messages(None, search=query, limit=limit):
            text = (message.message or "").strip()
            if not text:
                continue
            chat = await message.get_chat()
            chat_id, title, username, is_channel = _chat_meta(chat)
            if not self._allowed_chat(chat_id, username):
                continue
            author_id, author_username, author_name = _author_meta(
                await message.get_sender()
            )
            self.stats["search"] += 1
            count += 1
            await self.sink.put(
                RawItem(
                    source="telegram_search",
                    text=text,
                    chat_id=_full_chat_id(chat_id, is_channel),
                    chat_title=title,
                    chat_username=username,
                    message_id=message.id,
                    author_id=author_id,
                    author_username=author_username,
                    author_name=author_name,
                    date=message.date.timestamp() if message.date else time.time(),
                    is_channel=is_channel,
                    extra={"query": query},
                )
            )
        return count


def _full_chat_id(chat_id: int | None, is_channel: bool) -> int | None:
    """Telethon отдаёт «короткий» id канала; ссылки требуют формат -100…"""
    if chat_id is None:
        return None
    if is_channel and chat_id > 0:
        return int(f"-100{chat_id}")
    return chat_id


def _in_list(values: Iterable[Any], chat_id: int | None, username: str | None) -> bool:
    for value in values:
        if isinstance(value, int):
            if chat_id is not None and value in (chat_id, _full_chat_id(chat_id, True)):
                return True
        else:
            text = str(value).lstrip("@").lower()
            if username and text == username.lower():
                return True
            if text.lstrip("-").isdigit() and chat_id is not None:
                if int(text) in (chat_id, _full_chat_id(chat_id, True)):
                    return True
    return False

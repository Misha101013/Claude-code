"""Общие части для всех источников."""

from __future__ import annotations

import asyncio
import logging
from typing import Protocol

from ..models import RawItem

log = logging.getLogger(__name__)


class ItemSink(Protocol):
    """Куда источники складывают найденные сообщения."""

    async def put(self, item: RawItem) -> None: ...


class QueueSink:
    """Очередь с ограничением: при лавине сообщений старые дропаются,
    иначе бэкфилл или спам-волна съедят всю память."""

    def __init__(self, maxsize: int = 5000) -> None:
        self.queue: asyncio.Queue[RawItem] = asyncio.Queue(maxsize=maxsize)
        self.dropped = 0

    async def put(self, item: RawItem) -> None:
        try:
            self.queue.put_nowait(item)
        except asyncio.QueueFull:
            self.dropped += 1
            if self.dropped % 100 == 1:
                log.warning("Очередь переполнена, отброшено сообщений: %s", self.dropped)

    async def get(self) -> RawItem:
        return await self.queue.get()

    def qsize(self) -> int:
        return self.queue.qsize()


async def run_periodically(
    name: str,
    interval_seconds,
    coro_factory,
    *,
    first_delay: float = 0.0,
    enabled=lambda: True,
) -> None:
    """Бесконечный цикл с защитой от падений: одна ошибка не роняет процесс.

    `interval_seconds` может быть функцией — тогда интервал перечитывается
    каждый раз, и смена настройки из бота применяется без перезапуска.
    """
    if first_delay:
        await asyncio.sleep(first_delay)
    while True:
        try:
            if enabled():
                await coro_factory()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — фоновая задача не должна падать
            log.exception("Ошибка в фоновой задаче %s", name)
        delay = interval_seconds() if callable(interval_seconds) else interval_seconds
        await asyncio.sleep(max(30.0, float(delay)))

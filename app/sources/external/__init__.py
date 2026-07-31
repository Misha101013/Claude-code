"""Внешние источники заказов (биржи и доски объявлений).

Выключены по умолчанию: включаются в конфиге или командой `/sources on`.
Каждый источник изолирован — падение одного не влияет ни на Telegram-поток,
ни на остальные биржи.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from ...config import Config
from ..base import ItemSink
from .base import ExternalSource
from .freelancehunt import FreelancehuntSource
from .hh_kz import HhKzSource
from .kwork import KworkSource
from .olx_kz import OlxKzSource

log = logging.getLogger(__name__)

REGISTRY: dict[str, type[ExternalSource]] = {
    "kwork": KworkSource,
    "freelancehunt": FreelancehuntSource,
    "olx_kz": OlxKzSource,
    "hh_kz": HhKzSource,
}

__all__ = ["REGISTRY", "ExternalSource", "build_sources", "poll_external"]


def build_sources(config: Config) -> list[ExternalSource]:
    sources: list[ExternalSource] = []
    for name, settings in config.section("external.sources").items():
        cls = REGISTRY.get(name)
        if cls is None:
            log.warning("Неизвестный внешний источник в конфиге: %s", name)
            continue
        if not (settings or {}).get("enabled", False):
            continue
        sources.append(cls(name, settings or {}))
    return sources


async def poll_external(
    config: Config, sink: ItemSink, client: httpx.AsyncClient
) -> dict[str, int]:
    """Один проход по всем включённым биржам."""
    if not config.get("external.enabled", False):
        return {}
    results: dict[str, int] = {}
    for source in build_sources(config):
        try:
            items = await source.fetch(client)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — биржа не должна ронять бота
            log.warning("Источник %s не ответил: %s", source.name, exc)
            results[source.name] = -1
            continue
        for item in items:
            await sink.put(item)
        results[source.name] = len(items)
        await asyncio.sleep(2.0)  # вежливая пауза между сайтами
    return results

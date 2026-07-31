"""Базовый класс внешнего источника."""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from ...models import RawItem

log = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36"
)


class ExternalSource:
    """Один сайт-источник. Наследники реализуют `fetch`."""

    def __init__(self, name: str, settings: dict[str, Any]) -> None:
        self.name = name
        self.settings = settings
        self.url = str(settings.get("url", ""))
        self.last_error: str | None = None

    async def fetch(self, client: httpx.AsyncClient) -> list[RawItem]:
        raise NotImplementedError

    # ------------------------------------------------------------------
    async def _get(
        self, client: httpx.AsyncClient, url: str, **kwargs: Any
    ) -> httpx.Response:
        headers = {
            "User-Agent": USER_AGENT,
            "Accept-Language": "ru,en;q=0.8",
            **kwargs.pop("headers", {}),
        }
        response = await client.get(url, headers=headers, follow_redirects=True, **kwargs)
        response.raise_for_status()
        return response

    def make_item(
        self,
        text: str,
        url: str | None = None,
        title: str = "",
        date: float | None = None,
    ) -> RawItem:
        return RawItem(
            source=self.name,
            text=text.strip(),
            chat_title=title or self.name,
            url=url,
            date=date or time.time(),
            extra={"external": True},
        )

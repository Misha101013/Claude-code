"""Kwork: биржа фриланса, раздел разработки сайтов.

Разметка Kwork меняется, поэтому сначала пробуем JSON, который сайт кладёт
в `window.stateData`, и только потом — HTML-карточки.
"""

from __future__ import annotations

import json
import re

import httpx
from selectolax.parser import HTMLParser

from ...models import RawItem
from .base import ExternalSource

_STATE = re.compile(r"window\.stateData\s*=\s*(\{.*?\});", re.DOTALL)
_PROJECT_LINK = re.compile(r"^/projects/(\d+)")


class KworkSource(ExternalSource):
    async def fetch(self, client: httpx.AsyncClient) -> list[RawItem]:
        url = self.url or "https://kwork.ru/projects?c=41"
        response = await self._get(client, url)
        items = self._from_state(response.text)
        if items:
            return items
        return self._from_html(response.text)

    # ------------------------------------------------------------------
    def _from_state(self, html: str) -> list[RawItem]:
        match = _STATE.search(html)
        if not match:
            return []
        try:
            data = json.loads(match.group(1))
        except json.JSONDecodeError:
            return []

        wants = data.get("wants") or data.get("projects") or []
        if isinstance(wants, dict):
            wants = list(wants.values())

        items: list[RawItem] = []
        for want in wants:
            if not isinstance(want, dict):
                continue
            title = str(want.get("name") or want.get("title") or "")
            body = str(want.get("description") or want.get("desc") or "")
            budget = want.get("priceLimit") or want.get("price") or ""
            want_id = want.get("id") or want.get("wantId")
            if not (title or body):
                continue
            text = "\n".join(part for part in (title, body) if part)
            if budget:
                text += f"\nБюджет: {budget} руб"
            items.append(
                self.make_item(
                    text,
                    url=f"https://kwork.ru/projects/{want_id}" if want_id else None,
                    title="Kwork",
                )
            )
        return items

    def _from_html(self, html: str) -> list[RawItem]:
        tree = HTMLParser(html)
        items: list[RawItem] = []
        for node in tree.css("a"):
            href = node.attributes.get("href") or ""
            match = _PROJECT_LINK.match(href)
            if not match:
                continue
            title = node.text(strip=True)
            if len(title) < 15:
                continue
            items.append(
                self.make_item(
                    title,
                    url=f"https://kwork.ru{href}",
                    title="Kwork",
                )
            )
        return items[:50]

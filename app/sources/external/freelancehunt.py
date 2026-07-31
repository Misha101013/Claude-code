"""Freelancehunt: список проектов по разработке сайтов."""

from __future__ import annotations

import re

import httpx
from selectolax.parser import HTMLParser

from ...models import RawItem
from .base import ExternalSource

_PROJECT_LINK = re.compile(r"/project/[^/]*?(\d+)\.html")


class FreelancehuntSource(ExternalSource):
    async def fetch(self, client: httpx.AsyncClient) -> list[RawItem]:
        url = self.url or "https://freelancehunt.com/projects"
        response = await self._get(client, url)
        tree = HTMLParser(response.text)

        items: list[RawItem] = []
        seen: set[str] = set()
        for row in tree.css("tr, div.project"):
            link = None
            for node in row.css("a"):
                href = node.attributes.get("href") or ""
                if _PROJECT_LINK.search(href):
                    link = node
                    break
            if link is None:
                continue
            href = link.attributes.get("href") or ""
            if href in seen:
                continue
            seen.add(href)

            title = link.text(strip=True)
            body = row.text(strip=True, separator=" ")
            # В строке таблицы лежит и заголовок, и краткое описание с бюджетом.
            text = body if len(body) > len(title) else title
            if len(text) < 25:
                continue
            items.append(
                self.make_item(
                    text[:2000],
                    url=href if href.startswith("http") else f"https://freelancehunt.com{href}",
                    title="Freelancehunt",
                )
            )
        return items[:50]

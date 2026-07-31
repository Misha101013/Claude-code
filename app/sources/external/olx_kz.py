"""OLX Казахстан: объявления «нужен сайт» в разделе услуг."""

from __future__ import annotations

import httpx
from selectolax.parser import HTMLParser

from ...models import RawItem
from .base import ExternalSource


class OlxKzSource(ExternalSource):
    async def fetch(self, client: httpx.AsyncClient) -> list[RawItem]:
        url = self.url or "https://www.olx.kz/uslugi/it-kompyutery/"
        response = await self._get(client, url)
        tree = HTMLParser(response.text)

        items: list[RawItem] = []
        seen: set[str] = set()
        for card in tree.css('[data-cy="l-card"], div.offer-wrapper'):
            link_node = card.css_first("a")
            if link_node is None:
                continue
            href = link_node.attributes.get("href") or ""
            if not href or href in seen:
                continue
            seen.add(href)

            title_node = card.css_first("h4, h6, .title-cell")
            title = title_node.text(strip=True) if title_node else link_node.text(strip=True)
            price_node = card.css_first('[data-testid="ad-price"], .price')
            price = price_node.text(strip=True) if price_node else ""
            location_node = card.css_first('[data-testid="location-date"]')
            location = location_node.text(strip=True) if location_node else ""

            text = "\n".join(part for part in (title, price, location) if part)
            if len(text) < 20:
                continue
            items.append(
                self.make_item(
                    text,
                    url=href if href.startswith("http") else f"https://www.olx.kz{href}",
                    title="OLX.kz",
                )
            )
        return items[:50]

"""hh.kz через публичный API. Тут в основном вакансии, поэтому источник
выключен по умолчанию — включайте, если берёте и проектную работу в штат."""

from __future__ import annotations

import httpx

from ...models import RawItem
from .base import ExternalSource

DEFAULT_URL = (
    "https://api.hh.ru/vacancies?area=40&text=разработка+сайта"
    "&per_page=50&order_by=publication_time"
)


class HhKzSource(ExternalSource):
    async def fetch(self, client: httpx.AsyncClient) -> list[RawItem]:
        response = await self._get(
            client,
            self.url or DEFAULT_URL,
            headers={"Accept": "application/json"},
        )
        payload = response.json()
        items: list[RawItem] = []
        for vacancy in payload.get("items", []):
            snippet = vacancy.get("snippet") or {}
            parts = [
                vacancy.get("name") or "",
                snippet.get("requirement") or "",
                snippet.get("responsibility") or "",
                (vacancy.get("employer") or {}).get("name") or "",
                (vacancy.get("area") or {}).get("name") or "",
            ]
            salary = vacancy.get("salary") or {}
            if salary.get("from"):
                parts.append(f"Бюджет: {salary['from']} {salary.get('currency', 'KZT')}")
            text = "\n".join(part for part in parts if part)
            if len(text) < 25:
                continue
            items.append(
                self.make_item(text, url=vacancy.get("alternate_url"), title="hh.kz")
            )
        return items

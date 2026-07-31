"""ИИ-классификатор на Gemini API.

Вызывается только для спорных сообщений (серая зона по правилам), поэтому
расход токенов остаётся небольшим. Если ключа нет, лимит исчерпан или API
недоступен — пайплайн продолжает работать на одних правилах.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import OrderedDict
from dataclasses import replace
from datetime import date
from typing import Any

import httpx

from ..config import Config
from ..models import AIVerdict

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """Ты — фильтр лидов для веб-студии из Казахстана.
Тебе дают текст сообщения из Telegram-чата или с биржи фриланса.

Верни is_order = true ТОЛЬКО если автор сам ищет исполнителя на разработку,
доработку или редизайн сайта / лендинга / интернет-магазина / веб-сервиса.

is_order = false, если это:
- реклама или самопрезентация исполнителя, студии, портфолио, прайс;
- резюме, поиск работы, отклик на вакансию;
- вакансия в штат на полный день (не заказ на проект);
- обсуждение, вопрос по технологиям, мемы, флуд, спам, курсы и обучение;
- продажа готовых сайтов, доменов, шаблонов, аккаунтов.

geo_kz = true, если заказ связан с Казахстаном (город, тенге, .kz, номер +7 7xx,
казахстанский бизнес) или явных признаков другой страны нет, но чат казахстанский.
budget_kzt — бюджет в тенге числом, если он указан (доллары считай по курсу 520),
иначе null. urgency: "high" | "normal" | "low".
category — короткая метка: "лендинг", "интернет-магазин", "корпоративный сайт",
"доработка", "веб-приложение", "другое".
reason — одна короткая фраза по-русски, почему такое решение."""

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "is_order": {"type": "boolean"},
        "confidence": {"type": "number"},
        "category": {"type": "string"},
        "budget_kzt": {"type": "integer", "nullable": True},
        "urgency": {"type": "string", "enum": ["high", "normal", "low"]},
        "geo_kz": {"type": "boolean"},
        "reason": {"type": "string"},
    },
    "required": ["is_order", "confidence", "category", "urgency", "geo_kz", "reason"],
}


class GeminiClassifier:
    """Тонкая обёртка над generateContent с ретраями, кэшем и лимитом."""

    def __init__(
        self,
        config: Config,
        api_key: str | None,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.config = config
        self.api_key = api_key
        self._client = client
        self._owns_client = client is None
        self._cache: OrderedDict[str, AIVerdict] = OrderedDict()
        self._cache_limit = 2000
        self._calls_date = date.today().isoformat()
        self._calls_today = 0
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    @property
    def enabled(self) -> bool:
        return bool(self.api_key) and self.config.get("ai.mode", "grey_zone") != "off"

    @property
    def calls_today(self) -> int:
        self._roll_day()
        return self._calls_today

    def _roll_day(self) -> None:
        today = date.today().isoformat()
        if today != self._calls_date:
            self._calls_date = today
            self._calls_today = 0

    def _limit_reached(self) -> bool:
        self._roll_day()
        limit = int(self.config.get("ai.daily_limit", 1500) or 0)
        return bool(limit) and self._calls_today >= limit

    async def client(self) -> httpx.AsyncClient:
        if self._client is None:
            timeout = float(self.config.get("ai.timeout_seconds", 30) or 30)
            self._client = httpx.AsyncClient(timeout=timeout)
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------------
    async def classify(self, text: str, *, cache_key: str | None = None) -> AIVerdict:
        if not self.enabled:
            return AIVerdict(is_order=False, error="ai_disabled")
        if self._limit_reached():
            return AIVerdict(is_order=False, error="daily_limit")

        use_cache = bool(self.config.get("ai.cache", True)) and cache_key
        if use_cache and cache_key in self._cache:
            cached = self._cache[cache_key]
            self._cache.move_to_end(cache_key)
            return replace(cached, from_cache=True)

        verdict = await self._call(text)

        if use_cache and verdict.ok:
            self._cache[cache_key] = verdict
            while len(self._cache) > self._cache_limit:
                self._cache.popitem(last=False)
        return verdict

    # ------------------------------------------------------------------
    async def _call(self, text: str) -> AIVerdict:
        model = str(self.config.get("ai.model", "gemini-3.6-flash"))
        base = str(self.config.get("ai.api_base")).rstrip("/")
        url = f"{base}/models/{model}:generateContent"
        payload: dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": text[:6000]}]}],
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "application/json",
                "responseSchema": RESPONSE_SCHEMA,
            },
        }
        thinking = str(self.config.get("ai.thinking_level", "") or "").lower()
        if thinking in {"none", "low", "high"}:
            # Gemini 3.x: thinking_level вместо устаревшего thinking_budget.
            payload["generationConfig"]["thinkingConfig"] = {"thinkingLevel": thinking}

        retries = int(self.config.get("ai.max_retries", 3) or 1)
        client = await self.client()
        delay = 1.0
        last_error = "unknown"

        for attempt in range(1, retries + 1):
            async with self._lock:
                self._roll_day()
                self._calls_today += 1
            try:
                response = await client.post(
                    url,
                    params={"key": self.api_key},
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = f"network: {exc.__class__.__name__}"
            else:
                if response.status_code == 200:
                    parsed = self._parse(response.json())
                    if parsed is not None:
                        return parsed
                    last_error = "bad_response"
                elif response.status_code in (429, 500, 502, 503, 504):
                    last_error = f"http_{response.status_code}"
                else:
                    detail = response.text[:200].replace("\n", " ")
                    log.warning("Gemini вернул %s: %s", response.status_code, detail)
                    return AIVerdict(
                        is_order=False, error=f"http_{response.status_code}"
                    )

            if attempt < retries:
                await asyncio.sleep(delay)
                delay = min(delay * 2, 8.0)

        log.warning("Gemini недоступен (%s), работаем на правилах", last_error)
        return AIVerdict(is_order=False, error=last_error)

    # ------------------------------------------------------------------
    @staticmethod
    def _parse(data: dict[str, Any]) -> AIVerdict | None:
        try:
            parts = data["candidates"][0]["content"]["parts"]
            raw = "".join(part.get("text", "") for part in parts).strip()
            if not raw:
                return None
            payload = json.loads(raw)
        except (KeyError, IndexError, TypeError, json.JSONDecodeError):
            return None

        budget = payload.get("budget_kzt")
        try:
            budget_value = int(budget) if budget not in (None, "", 0) else None
        except (TypeError, ValueError):
            budget_value = None

        try:
            confidence = float(payload.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0

        return AIVerdict(
            is_order=bool(payload.get("is_order")),
            confidence=max(0.0, min(1.0, confidence)),
            category=str(payload.get("category", ""))[:64],
            budget_kzt=budget_value,
            urgency=str(payload.get("urgency", ""))[:16],
            geo_kz=payload.get("geo_kz"),
            reason=str(payload.get("reason", ""))[:300],
        )


class NullClassifier(GeminiClassifier):
    """Заглушка для `--dry-run` и тестов: ИИ никогда не вызывается."""

    def __init__(self, config: Config) -> None:
        super().__init__(config, api_key=None)

    async def classify(self, text: str, *, cache_key: str | None = None) -> AIVerdict:
        return AIVerdict(is_order=False, error="ai_disabled")


def build_classifier(config: Config, api_key: str | None) -> GeminiClassifier:
    if not api_key:
        log.info("GEMINI_API_KEY не задан — ИИ-слой отключён, работают правила")
        return NullClassifier(config)
    return GeminiClassifier(config, api_key)

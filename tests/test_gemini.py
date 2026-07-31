"""Проверяем разбор ответа Gemini, ретраи и лимиты — без реальной сети."""

from __future__ import annotations

import json

import httpx
import pytest

from app.config import Config
from app.filters.gemini import GeminiClassifier


def gemini_response(payload: dict) -> httpx.Response:
    body = {
        "candidates": [
            {"content": {"parts": [{"text": json.dumps(payload, ensure_ascii=False)}]}}
        ]
    }
    return httpx.Response(200, json=body)


@pytest.fixture
def config() -> Config:
    return Config.load("config.example.yaml")


def make_classifier(config: Config, handler) -> GeminiClassifier:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return GeminiClassifier(config, "test-key", client=client)


async def test_parses_structured_verdict(config):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return gemini_response(
            {
                "is_order": True,
                "confidence": 0.91,
                "category": "лендинг",
                "budget_kzt": 250000,
                "urgency": "high",
                "geo_kz": True,
                "reason": "человек ищет исполнителя",
            }
        )

    classifier = make_classifier(config, handler)
    verdict = await classifier.classify("нужен лендинг, бюджет 250 000 тг")

    assert verdict.ok and verdict.is_order
    assert verdict.confidence == pytest.approx(0.91)
    assert verdict.budget_kzt == 250_000
    assert verdict.category == "лендинг"
    assert "gemini" in captured["url"]
    assert captured["body"]["generationConfig"]["responseMimeType"] == "application/json"
    await classifier.aclose()


async def test_retries_on_429_then_succeeds(config):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, json={"error": "rate limited"})
        return gemini_response(
            {
                "is_order": False,
                "confidence": 0.8,
                "category": "другое",
                "urgency": "low",
                "geo_kz": False,
                "reason": "реклама",
            }
        )

    config.set_override("ai.model", "gemini-3.6-flash")
    classifier = make_classifier(config, handler)
    classifier.config._data["ai"]["max_retries"] = 3
    classifier.config._data["ai"]["timeout_seconds"] = 1

    verdict = await classifier.classify("делаем сайты под ключ")
    assert calls["n"] == 2
    assert verdict.ok and not verdict.is_order
    await classifier.aclose()


async def test_broken_json_is_not_fatal(config):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"candidates": [{"content": {"parts": [{"text": "не json"}]}}]}
        )

    classifier = make_classifier(config, handler)
    verdict = await classifier.classify("нужен сайт")
    assert not verdict.ok
    assert verdict.error == "bad_response"
    await classifier.aclose()


async def test_daily_limit_stops_calls(config):
    def handler(request: httpx.Request) -> httpx.Response:
        return gemini_response(
            {
                "is_order": True,
                "confidence": 0.9,
                "category": "сайт",
                "urgency": "normal",
                "geo_kz": True,
                "reason": "ок",
            }
        )

    config.set_override("ai.daily_limit", 1)
    classifier = make_classifier(config, handler)

    first = await classifier.classify("нужен сайт для кафе", cache_key="a")
    second = await classifier.classify("нужен сайт для салона", cache_key="b")

    assert first.ok
    assert second.error == "daily_limit"
    await classifier.aclose()


async def test_cache_prevents_second_call(config):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return gemini_response(
            {
                "is_order": True,
                "confidence": 0.9,
                "category": "сайт",
                "urgency": "normal",
                "geo_kz": True,
                "reason": "ок",
            }
        )

    classifier = make_classifier(config, handler)
    await classifier.classify("нужен сайт", cache_key="same")
    cached = await classifier.classify("нужен сайт", cache_key="same")

    assert calls["n"] == 1
    assert cached.from_cache
    await classifier.aclose()


async def test_disabled_without_api_key(config):
    classifier = GeminiClassifier(config, None)
    assert not classifier.enabled
    verdict = await classifier.classify("нужен сайт")
    assert verdict.error == "ai_disabled"

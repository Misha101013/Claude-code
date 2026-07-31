from __future__ import annotations

import time

import pytest

from app.config import Config
from app.filters.gemini import GeminiClassifier, NullClassifier
from app.filters.rules import RuleEngine
from app.models import AIVerdict, RawItem
from app.pipeline import Pipeline
from app.storage import Storage

ORDER_TEXT = (
    "Нужен лендинг для стоматологии в Алматы. Бюджет 250 000 тг, сроки 2 недели. "
    "Кто может взяться — пишите @clinic_owner"
)


def make_item(text: str = ORDER_TEXT, **kwargs) -> RawItem:
    params = {
        "source": "telegram",
        "text": text,
        "chat_id": -1001234567890,
        "chat_title": "Фриланс Алматы",
        "message_id": 42,
        "author_id": 555,
        "author_username": "clinic_owner",
        "date": time.time(),
    }
    params.update(kwargs)
    return RawItem(**params)


class StubClassifier(GeminiClassifier):
    """ИИ с заранее заданным ответом — тесты не ходят в сеть."""

    def __init__(self, config: Config, verdict: AIVerdict) -> None:
        super().__init__(config, api_key="test-key")
        self.verdict = verdict
        self.calls = 0

    async def classify(self, text: str, *, cache_key: str | None = None) -> AIVerdict:
        self.calls += 1
        return self.verdict


@pytest.fixture
async def storage(tmp_path):
    store = Storage(tmp_path / "test.db")
    await store.open()
    yield store
    await store.close()


@pytest.fixture
def fresh_config() -> Config:
    return Config.load("config.example.yaml")


async def build(config: Config, storage: Storage, classifier=None) -> Pipeline:
    rules = RuleEngine(config)
    pipeline = Pipeline(config, rules, classifier or NullClassifier(config), storage)
    await pipeline.prepare()
    return pipeline


async def test_order_becomes_lead_and_is_saved(fresh_config, storage):
    pipeline = await build(fresh_config, storage)
    decision = await pipeline.process(make_item())

    assert decision.accepted, decision.reason
    assert decision.lead is not None
    assert decision.lead.id
    saved = await storage.get_lead(decision.lead.id)
    assert saved is not None
    assert saved["city"] == "Алматы"
    assert saved["budget_kzt"] == 250_000
    assert saved["chat_title"] == "Фриланс Алматы"


async def test_crosspost_is_deduplicated(fresh_config, storage):
    pipeline = await build(fresh_config, storage)
    first = await pipeline.process(make_item())
    second = await pipeline.process(
        make_item(chat_id=-1009999999999, chat_title="IT Казахстан", message_id=7)
    )

    assert first.accepted
    assert second.stage == "duplicate"
    lead = await storage.get_lead(first.lead.id)
    assert lead["seen_count"] == 2


async def test_banned_chat_is_skipped(fresh_config, storage):
    await storage.ban("chat", -1001234567890, "Фриланс Алматы")
    pipeline = await build(fresh_config, storage)
    decision = await pipeline.process(make_item())
    assert decision.stage == "banned"


async def test_ai_can_reject_a_grey_zone_message(fresh_config, storage):
    fresh_config.set_override("scoring.ai_low", 0)
    fresh_config.set_override("scoring.ai_high", 100)
    classifier = StubClassifier(
        fresh_config,
        AIVerdict(is_order=False, confidence=0.9, reason="реклама студии"),
    )
    pipeline = await build(fresh_config, storage, classifier)

    decision = await pipeline.process(make_item())
    assert classifier.calls == 1
    assert decision.stage == "ai_reject"
    assert "реклама" in decision.reason


async def test_ai_can_rescue_a_weak_message(fresh_config, storage):
    fresh_config.set_override("scoring.notify_threshold", 60)
    fresh_config.set_override("scoring.ai_low", 0)
    fresh_config.set_override("scoring.ai_high", 100)
    classifier = StubClassifier(
        fresh_config,
        AIVerdict(is_order=True, confidence=0.95, category="лендинг", geo_kz=True),
    )
    pipeline = await build(fresh_config, storage, classifier)

    weak = make_item("Кто может сделать простой сайт для кафе? Астана")
    decision = await pipeline.process(weak)
    assert decision.accepted
    assert decision.score > 60


async def test_ai_not_called_outside_grey_zone(fresh_config, storage):
    fresh_config.set_override("scoring.ai_low", 90)
    fresh_config.set_override("scoring.ai_high", 100)
    classifier = StubClassifier(fresh_config, AIVerdict(is_order=True, confidence=1.0))
    pipeline = await build(fresh_config, storage, classifier)

    await pipeline.process(make_item())
    assert classifier.calls == 0


async def test_advertisement_never_reaches_ai(fresh_config, storage):
    classifier = StubClassifier(fresh_config, AIVerdict(is_order=True, confidence=1.0))
    pipeline = await build(fresh_config, storage, classifier)

    decision = await pipeline.process(
        make_item("Делаем сайты под ключ! Наша студия, портфолио, цена от 60 000 тг")
    )
    assert decision.stage == "rules_reject"
    assert classifier.calls == 0


async def test_chat_stats_are_collected(fresh_config, storage):
    pipeline = await build(fresh_config, storage)
    await pipeline.process(make_item())
    await pipeline.process(make_item("Обсуждаем погоду в чате, ничего про сайты"))

    rows = await storage.top_chats()
    assert rows
    assert rows[0]["leads"] == 1
    assert rows[0]["scanned"] >= 1

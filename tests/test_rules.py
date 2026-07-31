"""Главная проверка качества: заказы проходят, реклама и мусор — нет."""

from __future__ import annotations

import pytest

ORDER_LABELS = {"order", "order_obfuscated"}
JUNK_LABELS = {"ad", "resume", "vacancy", "spam", "chat", "too_short"}


def test_real_orders_score_high(rules, messages, config):
    threshold = int(config.get("scoring.notify_threshold"))
    for message in messages:
        if message["label"] not in ORDER_LABELS:
            continue
        _, result = rules.evaluate(message["text"])
        assert not result.rejected, f"заказ отсеян: {message['text'][:60]} — {result.reject_reason}"
        assert result.score >= threshold, (
            f"мало очков ({result.score}) у заказа: {message['text'][:60]}"
        )


def test_junk_is_filtered(rules, messages, config):
    threshold = int(config.get("scoring.notify_threshold"))
    for message in messages:
        if message["label"] not in JUNK_LABELS:
            continue
        _, result = rules.evaluate(message["text"])
        assert result.rejected or result.score < threshold, (
            f"мусор прошёл ({result.score}): {message['text'][:60]}"
        )


def test_studio_ad_rejected_as_offer(rules):
    _, result = rules.evaluate(
        "Делаем сайты под ключ! Наша студия, портфолио в закрепе, цена от 60 000 тг"
    )
    assert result.rejected
    assert "предложение" in result.reject_reason or "стоп" in result.reject_reason


def test_off_topic_is_rejected_fast(rules):
    _, result = rules.evaluate("Продам гараж в центре Алматы, недорого, срочно, 2 млн тенге")
    assert result.rejected
    assert result.reject_reason == "нет тематических слов"


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Нужен сайт, бюджет 250 000 тг", 250_000),
        ("Нужен лендинг, бюджет 300к", 300_000),
        ("Нужен сайт за 150 тыс тенге", 150_000),
        ("Нужен интернет-магазин, бюджет $1000", 520_000),
        ("Нужен сайт, готов заплатить 1 млн тенге", 1_000_000),
        ("Нужен сайт для компании", None),
    ],
)
def test_budget_extraction(rules, text, expected):
    _, result = rules.evaluate(text)
    assert result.budget_kzt == expected


def test_city_and_contacts_extracted(rules):
    _, result = rules.evaluate(
        "Нужен лендинг для кофейни в Астане, бюджет 200 000 тг, "
        "пишите @coffee_owner или +7 701 234 56 78"
    )
    assert result.city == "Астана"
    assert "@coffee_owner" in result.contacts
    assert any(contact.startswith("+7") for contact in result.contacts)


def test_foreign_order_loses_points(rules, config):
    threshold = int(config.get("scoring.notify_threshold"))
    _, foreign = rules.evaluate(
        "Нужен разработчик для сайта компании, Москва, бюджет 200 000 рублей"
    )
    _, local = rules.evaluate(
        "Нужен разработчик для сайта компании, Алматы, бюджет 200 000 тенге"
    )
    assert foreign.score < threshold <= local.score
    assert foreign.matched.get("foreign")


def test_foreign_words_ignored_when_kazakhstan_mentioned(rules):
    _, result = rules.evaluate(
        "Нужен сайт для филиала в Алматы, головной офис в Москве, бюджет 400 000 тг"
    )
    assert not result.matched.get("foreign")
    assert result.score >= 50


def test_urgency_detected(rules):
    _, result = rules.evaluate("Срочно нужен сайт для доставки еды, Алматы, бюджет 300к")
    assert result.urgent


def test_keyword_edits_change_behaviour(config, rules):
    text = "Нужен сайт для интернет-казино, бюджет 500 000 тг"
    _, before = rules.evaluate(text)
    assert before.rejected  # «казино» уже в стоп-словах

    config.edit_keyword("stop", "казино", add=False)
    rules.rebuild()
    try:
        _, after = rules.evaluate(text)
        assert not after.rejected
    finally:
        config.edit_keyword("stop", "казино", add=True)
        rules.rebuild()

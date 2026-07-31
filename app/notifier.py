"""Карточка лида и её отправка владельцу."""

from __future__ import annotations

import asyncio
import html
import logging
import time

from aiogram import Bot
from aiogram.exceptions import TelegramRetryAfter
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from .config import Config
from .models import Lead

log = logging.getLogger(__name__)

_SOURCE_LABELS = {
    "telegram": "Telegram",
    "telegram_backfill": "Telegram (история)",
    "telegram_search": "Telegram (поиск)",
    "kwork": "Kwork",
    "freelancehunt": "Freelancehunt",
    "olx_kz": "OLX.kz",
    "hh_kz": "hh.kz",
}


def _fire(score: int) -> str:
    if score >= 85:
        return "🔥🔥"
    if score >= 70:
        return "🔥"
    return "✨"


def format_money(value: int | None) -> str | None:
    if not value:
        return None
    return f"{value:,}".replace(",", " ") + " ₸"


def format_lead(lead: Lead, config: Config) -> str:
    item = lead.item
    limit = int(config.get("notify.text_limit", 900) or 900)
    text = item.text.strip()
    if len(text) > limit:
        text = text[:limit].rstrip() + "…"

    lines: list[str] = [
        f"{_fire(lead.score)} <b>Лид {lead.score}/100</b> · {html.escape(lead.category)}"
    ]

    facts: list[str] = []
    money = format_money(lead.budget_kzt)
    if money:
        facts.append(f"💰 {money}")
    if lead.rules.city:
        facts.append(f"📍 {html.escape(lead.rules.city)}")
    if lead.rules.urgent:
        facts.append("⚡ срочно")
    if lead.seen_count > 1:
        facts.append(f"👀 постов: {lead.seen_count}")
    if facts:
        lines.append(" · ".join(facts))

    source = _SOURCE_LABELS.get(item.source, item.source)
    where = html.escape(item.source_title or source)
    if item.link:
        lines.append(f'💬 <a href="{html.escape(item.link, quote=True)}">{where}</a> · {source}')
    else:
        lines.append(f"💬 {where} · {source}")

    author_bits: list[str] = []
    if item.author_username:
        author_bits.append(f"@{html.escape(item.author_username)}")
    if item.author_name:
        author_bits.append(html.escape(item.author_name))
    if author_bits:
        lines.append("👤 " + " · ".join(author_bits))

    extra_contacts = [c for c in lead.rules.contacts if c.lstrip("@") != (item.author_username or "")]
    if extra_contacts:
        lines.append("📞 " + html.escape(", ".join(extra_contacts)))

    lines.append("")
    lines.append(f"<blockquote>{html.escape(text)}</blockquote>")

    if lead.ai is not None and lead.ai.ok and lead.ai.reason:
        confidence = int(lead.ai.confidence * 100)
        lines.append(f"🤖 ИИ ({confidence}%): {html.escape(lead.ai.reason)}")

    if config.get("notify.show_debug", True):
        explain = lead.rules.explain()
        if explain:
            lines.append(f"<i>⚙️ {html.escape(explain)[:300]}</i>")

    return "\n".join(lines)


def lead_keyboard(lead: Lead) -> InlineKeyboardMarkup:
    lead_id = lead.id or 0
    rows = [
        [
            InlineKeyboardButton(text="✅ В работу", callback_data=f"lead:take:{lead_id}"),
            InlineKeyboardButton(text="🗑 Мусор", callback_data=f"lead:junk:{lead_id}"),
        ],
        [
            InlineKeyboardButton(text="⛔ Бан автора", callback_data=f"lead:banuser:{lead_id}"),
            InlineKeyboardButton(text="🔕 Бан чата", callback_data=f"lead:banchat:{lead_id}"),
        ],
    ]
    if lead.item.link:
        rows.insert(
            0, [InlineKeyboardButton(text="🔗 Открыть сообщение", url=lead.item.link)]
        )
    return InlineKeyboardMarkup(inline_keyboard=rows)


class Notifier:
    """Шлёт лиды владельцу, не превышая лимит сообщений в минуту."""

    def __init__(self, bot: Bot, owner_id: int, config: Config) -> None:
        self.bot = bot
        self.owner_id = owner_id
        self.config = config
        self._window_start = time.time()
        self._sent_in_window = 0

    async def _throttle(self) -> None:
        limit = int(self.config.get("notify.rate_per_minute", 20) or 0)
        if not limit:
            return
        now = time.time()
        if now - self._window_start >= 60:
            self._window_start = now
            self._sent_in_window = 0
        if self._sent_in_window >= limit:
            await asyncio.sleep(max(0.0, 60 - (now - self._window_start)))
            self._window_start = time.time()
            self._sent_in_window = 0
        self._sent_in_window += 1

    async def send_lead(self, lead: Lead) -> None:
        await self._throttle()
        text = format_lead(lead, self.config)
        try:
            await self.bot.send_message(
                self.owner_id,
                text,
                reply_markup=lead_keyboard(lead),
                disable_web_page_preview=True,
            )
        except TelegramRetryAfter as exc:
            await asyncio.sleep(exc.retry_after + 1)
            await self.bot.send_message(
                self.owner_id,
                text,
                reply_markup=lead_keyboard(lead),
                disable_web_page_preview=True,
            )
        except Exception:  # noqa: BLE001 — доставка не должна ронять пайплайн
            log.exception("Не удалось отправить лид %s", lead.id)

    async def send_text(self, text: str) -> None:
        try:
            await self.bot.send_message(self.owner_id, text, disable_web_page_preview=True)
        except Exception:  # noqa: BLE001
            log.exception("Не удалось отправить сообщение владельцу")

"""Панель управления в Telegram: команды владельца и кнопки под лидами."""

from __future__ import annotations

import html
import logging
import time
from pathlib import Path

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command, CommandObject
from aiogram.types import BufferedInputFile, CallbackQuery, Message

from .config import AI_MODES, KEYWORD_GROUPS
from .context import AppContext

log = logging.getLogger(__name__)

HELP = """<b>Парсер заказов на сайты — команды</b>

/stats — что происходит: лиды, отсев, топ-чаты
/check &lt;текст&gt; — прогнать текст через фильтры и увидеть решение
/threshold [N] — порог отправки лида (сейчас показывает текущий)
/ai [off|grey_zone|all] — режим ИИ; /ai model &lt;имя&gt;; /ai limit &lt;N&gt;
/keywords list &lt;группа&gt; — показать правила
/keywords add|del &lt;группа&gt; &lt;фраза&gt; — изменить правила
   группы: topic, intent, offer_anti, geo, stop, urgency
/sources — состояние источников
/sources external on|off — внешние биржи (kwork, olx.kz…)
/sources global on|off — глобальный поиск по Telegram
/sources scan — прогнать поиск и биржи прямо сейчас
/chats — какие чаты приносят лиды
/bans — чёрный список; /unban chat|author &lt;id&gt;
/export — выгрузить лиды в CSV
/pause, /resume — приостановить и возобновить парсинг
/reload — перечитать config.yaml с диска"""


def build_dispatcher(ctx: AppContext) -> Dispatcher:
    dp = Dispatcher()
    owner_id = int(ctx.secrets.owner_id or 0)
    is_owner = F.from_user.id == owner_id

    # ---------------------------------------------------------------- базовое
    @dp.message(Command("start", "help"), is_owner)
    async def cmd_help(message: Message) -> None:
        await message.answer(HELP)

    @dp.message(Command("stats"), is_owner)
    async def cmd_stats(message: Message) -> None:
        await message.answer(await _stats_text(ctx))

    @dp.message(Command("check"), is_owner)
    async def cmd_check(message: Message, command: CommandObject) -> None:
        text = (command.args or "").strip()
        if not text:
            await message.answer("Пришлите текст: <code>/check нужен лендинг, бюджет 200к</code>")
            return
        await message.answer(await _check_text(ctx, text))

    # ------------------------------------------------------------- настройки
    @dp.message(Command("threshold"), is_owner)
    async def cmd_threshold(message: Message, command: CommandObject) -> None:
        arg = (command.args or "").strip()
        if not arg:
            await message.answer(
                f"Порог отправки: <b>{ctx.config.get('scoring.notify_threshold')}</b>\n"
                "Изменить: <code>/threshold 60</code>"
            )
            return
        try:
            value = await ctx.set_setting("scoring.notify_threshold", int(arg))
        except ValueError:
            await message.answer("Нужно число от 0 до 100")
            return
        await message.answer(f"Порог отправки лида: <b>{value}</b>")

    @dp.message(Command("ai"), is_owner)
    async def cmd_ai(message: Message, command: CommandObject) -> None:
        args = (command.args or "").split()
        if not args:
            await message.answer(_ai_status(ctx))
            return

        head = args[0].lower()
        try:
            if head in AI_MODES:
                await ctx.set_setting("ai.mode", head)
            elif head == "model" and len(args) > 1:
                await ctx.set_setting("ai.model", args[1])
            elif head == "limit" and len(args) > 1:
                await ctx.set_setting("ai.daily_limit", int(args[1]))
            elif head in {"conf", "confidence"} and len(args) > 1:
                await ctx.set_setting("ai.min_confidence", float(args[1]))
            else:
                await message.answer(
                    "Варианты: <code>/ai off|grey_zone|all</code>, "
                    "<code>/ai model gemini-3.6-flash</code>, <code>/ai limit 500</code>"
                )
                return
        except (ValueError, KeyError) as exc:
            await message.answer(f"Не понял значение: {html.escape(str(exc))}")
            return
        await message.answer(_ai_status(ctx))

    # ------------------------------------------------------- ключевые слова
    @dp.message(Command("keywords"), is_owner)
    async def cmd_keywords(message: Message, command: CommandObject) -> None:
        args = (command.args or "").split(maxsplit=2)
        if len(args) < 2:
            await message.answer(
                "Формат: <code>/keywords list intent</code> или "
                "<code>/keywords add stop казино</code>\n"
                f"Группы: {', '.join(KEYWORD_GROUPS)}"
            )
            return

        action, group = args[0].lower(), args[1].lower()
        if group not in KEYWORD_GROUPS:
            await message.answer(f"Группы: {', '.join(KEYWORD_GROUPS)}")
            return

        if action == "list":
            phrases = ctx.config.keywords(group)
            body = ", ".join(html.escape(p) for p in phrases) or "пусто"
            await message.answer(f"<b>{group}</b> ({len(phrases)}):\n{body[:3500]}")
            return

        if len(args) < 3 or not args[2].strip():
            await message.answer("Не указана фраза")
            return
        phrase = args[2].strip()
        if action == "add":
            await ctx.edit_keyword(group, phrase, add=True)
            await message.answer(f"Добавил в <b>{group}</b>: {html.escape(phrase)}")
        elif action in {"del", "delete", "rm"}:
            await ctx.edit_keyword(group, phrase, add=False)
            await message.answer(f"Убрал из <b>{group}</b>: {html.escape(phrase)}")
        else:
            await message.answer("Действия: list, add, del")

    # ---------------------------------------------------------- источники
    @dp.message(Command("sources"), is_owner)
    async def cmd_sources(message: Message, command: CommandObject) -> None:
        args = (command.args or "").split()
        if not args:
            await message.answer(_sources_text(ctx))
            return

        head = args[0].lower()
        value = args[1].lower() if len(args) > 1 else ""
        flag = value in {"on", "вкл", "true", "1", "yes"}

        if head == "external" and value:
            await ctx.set_setting("external.enabled", flag)
        elif head == "global" and value:
            await ctx.set_setting("telegram.global_search.enabled", flag)
        elif head == "scan":
            await message.answer("Запускаю разовый прогон поиска и бирж…")
            await _manual_scan(ctx, message)
            return
        else:
            await message.answer(
                "Формат: <code>/sources external on</code>, "
                "<code>/sources global off</code>, <code>/sources scan</code>"
            )
            return
        await message.answer(_sources_text(ctx))

    @dp.message(Command("chats"), is_owner)
    async def cmd_chats(message: Message) -> None:
        rows = await ctx.storage.top_chats(15)
        if not rows:
            await message.answer("Пока нет статистики по чатам")
            return
        lines = ["<b>Топ чатов по лидам</b>"]
        for row in rows:
            title = html.escape(row["title"] or str(row["chat_id"]))
            lines.append(
                f"• {title} — лидов {row['leads']}, полезных {row['useful']}, "
                f"мусора {row['junk']}, просмотрено {row['scanned']}"
            )
        await message.answer("\n".join(lines)[:4000])

    # --------------------------------------------------------------- баны
    @dp.message(Command("bans"), is_owner)
    async def cmd_bans(message: Message) -> None:
        chats = await ctx.storage.banned_list("chat")
        authors = await ctx.storage.banned_list("author")
        lines = ["<b>Чёрный список</b>", "", "<i>Чаты:</i>"]
        lines += [f"• {row['value']} {html.escape(row['title'] or '')}" for row in chats] or ["  пусто"]
        lines += ["", "<i>Авторы:</i>"]
        lines += [f"• {row['value']} {html.escape(row['title'] or '')}" for row in authors] or ["  пусто"]
        lines += ["", "Снять: <code>/unban chat -1001234567890</code>"]
        await message.answer("\n".join(lines)[:4000])

    @dp.message(Command("unban"), is_owner)
    async def cmd_unban(message: Message, command: CommandObject) -> None:
        args = (command.args or "").split()
        if len(args) != 2 or args[0] not in {"chat", "author"}:
            await message.answer("Формат: <code>/unban chat -1001234567890</code>")
            return
        try:
            value = int(args[1])
        except ValueError:
            await message.answer("id должен быть числом")
            return
        await ctx.storage.unban(args[0], value)
        await ctx.refresh_bans()
        await message.answer("Снял из чёрного списка")

    # ------------------------------------------------------------- служебное
    @dp.message(Command("pause"), is_owner)
    async def cmd_pause(message: Message) -> None:
        await ctx.set_setting("paused", True)
        await message.answer("⏸ Парсинг приостановлен. Возобновить: /resume")

    @dp.message(Command("resume"), is_owner)
    async def cmd_resume(message: Message) -> None:
        await ctx.set_setting("paused", False)
        await message.answer("▶️ Парсинг возобновлён")

    @dp.message(Command("reload"), is_owner)
    async def cmd_reload(message: Message) -> None:
        await ctx.reload_config()
        await message.answer("Конфиг перечитан, правила пересобраны")

    @dp.message(Command("export"), is_owner)
    async def cmd_export(message: Message, command: CommandObject) -> None:
        days = 30
        arg = (command.args or "").strip()
        if arg.isdigit():
            days = int(arg)
        since = time.time() - days * 86400
        path = Path(ctx.secrets.data_dir) / "leads_export.csv"
        await ctx.storage.export_csv(path, since)
        data = path.read_bytes()
        await message.answer_document(
            BufferedInputFile(data, filename=f"leads_{days}d.csv"),
            caption=f"Лиды за {days} дн.",
        )

    # ----------------------------------------------------------- кнопки лида
    @dp.callback_query(F.data.startswith("lead:"), is_owner)
    async def on_lead_action(callback: CallbackQuery) -> None:
        _, action, raw_id = (callback.data or "").split(":", 2)
        lead_id = int(raw_id or 0)
        row = await ctx.storage.get_lead(lead_id) if lead_id else None
        if row is None:
            await callback.answer("Лид не найден в базе", show_alert=True)
            return

        if action == "take":
            await ctx.storage.set_lead_status(lead_id, "taken")
            await ctx.storage.touch_chat(row["chat_id"], row["chat_title"] or "", useful=1)
            await callback.answer("Взял в работу ✅")
        elif action == "junk":
            await ctx.storage.set_lead_status(lead_id, "junk")
            await ctx.storage.touch_chat(row["chat_id"], row["chat_title"] or "", junk=1)
            await callback.answer("Отметил как мусор 🗑")
        elif action == "banuser":
            if row["author_id"]:
                await ctx.storage.ban("author", int(row["author_id"]), row["author_username"] or "")
                await ctx.refresh_bans()
                await callback.answer("Автор в чёрном списке ⛔")
            else:
                await callback.answer("У лида нет автора", show_alert=True)
        elif action == "banchat":
            if row["chat_id"]:
                await ctx.storage.ban("chat", int(row["chat_id"]), row["chat_title"] or "")
                await ctx.refresh_bans()
                await callback.answer("Чат в чёрном списке 🔕")
            else:
                await callback.answer("У лида нет чата", show_alert=True)
        else:
            await callback.answer("Неизвестное действие")

        if callback.message is not None:
            marks = {"take": "✅", "junk": "🗑", "banuser": "⛔", "banchat": "🔕"}
            try:
                await callback.message.edit_reply_markup(reply_markup=None)
                await callback.message.edit_text(
                    f"{marks.get(action, '')} {callback.message.html_text}",
                    disable_web_page_preview=True,
                )
            except Exception:  # noqa: BLE001 — сообщение могли удалить
                pass

    @dp.message(is_owner)
    async def fallback(message: Message) -> None:
        if message.text and not message.text.startswith("/"):
            await message.answer(await _check_text(ctx, message.text))
        else:
            await message.answer("Не знаю такой команды. /help")

    return dp


# --------------------------------------------------------------------------
# Тексты ответов
# --------------------------------------------------------------------------
async def _stats_text(ctx: AppContext) -> str:
    now = time.time()
    day = await ctx.storage.count_leads_since(now - 86400)
    week = await ctx.storage.count_leads_since(now - 7 * 86400)
    counters = ctx.pipeline.stats()
    uptime = int(ctx.uptime_seconds // 60)
    queue = ctx.sink.qsize() if ctx.sink is not None else 0
    tg_stats = getattr(ctx.telegram, "stats", {}) if ctx.telegram else {}

    lines = [
        "<b>Статистика</b>",
        f"Лидов за сутки: <b>{day}</b>, за неделю: <b>{week}</b>",
        "",
        "<i>Отсев:</i>",
        f"• принято: {counters.get('accepted', 0)}",
        f"• дубликаты: {counters.get('duplicate', 0)}",
        f"• не по теме / реклама: {counters.get('rules_reject', 0)}",
        f"• мало очков: {counters.get('low_score', 0)}",
        f"• отклонил ИИ: {counters.get('ai_reject', 0)}",
        f"• ниже порога: {counters.get('below_threshold', 0)}",
        f"• чёрный список: {counters.get('banned', 0)}",
        "",
        f"Telegram: живых {tg_stats.get('live', 0)}, история {tg_stats.get('backfill', 0)}, "
        f"поиск {tg_stats.get('search', 0)}",
        f"Очередь: {queue} · В памяти отпечатков: {len(ctx.pipeline.dedup)}",
        f"Вызовов ИИ сегодня: {ctx.classifier.calls_today}",
        f"Порог: {ctx.config.get('scoring.notify_threshold')} · "
        f"ИИ: {ctx.config.get('ai.mode')} · "
        f"{'⏸ на паузе' if ctx.config.paused else '▶️ работает'}",
        f"Аптайм: {uptime} мин",
    ]
    return "\n".join(lines)


def _ai_status(ctx: AppContext) -> str:
    return (
        "<b>ИИ-классификатор</b>\n"
        f"Режим: <b>{ctx.config.get('ai.mode')}</b> ({'ключ есть' if ctx.classifier.api_key else 'ключа нет'})\n"
        f"Модель: <code>{ctx.config.get('ai.model')}</code>\n"
        f"Серая зона: {ctx.config.get('scoring.ai_low')}–{ctx.config.get('scoring.ai_high')}\n"
        f"Минимальная уверенность: {ctx.config.get('ai.min_confidence')}\n"
        f"Лимит в сутки: {ctx.config.get('ai.daily_limit')} · использовано: {ctx.classifier.calls_today}"
    )


def _sources_text(ctx: AppContext) -> str:
    external = ctx.config.get("external.enabled", False)
    names = [
        name
        for name, cfg in ctx.config.section("external.sources").items()
        if (cfg or {}).get("enabled")
    ]
    return (
        "<b>Источники</b>\n"
        f"Telegram (все чаты аккаунта): всегда включён\n"
        f"Глобальный поиск: {'вкл' if ctx.config.get('telegram.global_search.enabled') else 'выкл'} "
        f"(каждые {ctx.config.get('telegram.global_search.interval_minutes')} мин)\n"
        f"Внешние биржи: {'вкл' if external else 'выкл'} — {', '.join(names) or 'нет активных'}\n\n"
        "Переключить: <code>/sources external on</code>, <code>/sources global off</code>"
    )


async def _check_text(ctx: AppContext, text: str) -> str:
    """Прогон произвольного текста через тот же пайплайн — удобно для настройки."""
    norm, rules = ctx.rules.evaluate(text)
    lines = ["<b>Проверка текста</b>", f"Очки по правилам: <b>{rules.score}</b>"]
    if rules.rejected:
        lines.append(f"Отсев: {html.escape(rules.reject_reason)}")
    if rules.explain():
        lines.append(f"<i>{html.escape(rules.explain())[:600]}</i>")
    if rules.budget_kzt:
        lines.append(f"Бюджет: {rules.budget_kzt:,}".replace(",", " ") + " ₸")
    if rules.city:
        lines.append(f"Город: {html.escape(rules.city)}")
    if rules.contacts:
        lines.append("Контакты: " + html.escape(", ".join(rules.contacts)))

    if not rules.rejected and ctx.classifier.enabled:
        verdict = await ctx.classifier.classify(norm.text)
        if verdict.ok:
            lines.append(
                f"🤖 ИИ: {'заказ' if verdict.is_order else 'не заказ'} "
                f"({int(verdict.confidence * 100)}%) — {html.escape(verdict.reason)}"
            )
        else:
            lines.append(f"🤖 ИИ недоступен: {verdict.error}")

    threshold = int(ctx.config.get("scoring.notify_threshold", 50) or 0)
    verdict_line = "прошёл бы в лиды ✅" if (not rules.rejected and rules.score >= threshold) else "в лиды не попал бы"
    lines.append(f"Итог по правилам: {verdict_line} (порог {threshold})")
    return "\n".join(lines)


async def _manual_scan(ctx: AppContext, message: Message) -> None:
    """Разовый прогон глобального поиска и внешних бирж по команде."""
    report: list[str] = []
    if ctx.telegram is not None:
        try:
            found = await ctx.telegram.global_search()
            report.append(f"Глобальный поиск: {found} сообщений")
        except Exception as exc:  # noqa: BLE001
            report.append(f"Глобальный поиск упал: {html.escape(str(exc))}")

    if ctx.config.get("external.enabled", False) and ctx.sink is not None:
        import httpx

        from .sources.external import poll_external

        async with httpx.AsyncClient(timeout=30) as client:
            try:
                results = await poll_external(ctx.config, ctx.sink, client)
                for name, count in results.items():
                    report.append(
                        f"{name}: {'ошибка' if count < 0 else f'{count} объявлений'}"
                    )
            except Exception as exc:  # noqa: BLE001
                report.append(f"Биржи упали: {html.escape(str(exc))}")

    await message.answer("\n".join(report) or "Нечего сканировать")


def make_bot(token: str) -> Bot:
    from aiogram.client.default import DefaultBotProperties
    from aiogram.enums import ParseMode

    return Bot(token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))

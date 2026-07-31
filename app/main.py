"""Точка входа: запускает юзербот, бота-панель, пайплайн и фоновые задачи."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from pathlib import Path

from .config import Config, Secrets, load_secrets
from .context import AppContext
from .filters.gemini import build_classifier
from .filters.rules import RuleEngine
from .models import RawItem
from .pipeline import Pipeline
from .sources.base import QueueSink, run_periodically
from .storage import Storage

log = logging.getLogger("app")


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("telethon").setLevel(logging.WARNING)
    logging.getLogger("aiogram").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


# --------------------------------------------------------------------------
# Сборка контекста
# --------------------------------------------------------------------------
async def build_context(secrets: Secrets, *, with_storage: bool = True) -> AppContext:
    config = Config.load(secrets.config_path)
    storage = Storage(secrets.db_path)
    if with_storage:
        await storage.open()
        config.apply_overrides(await storage.load_settings())
        config.apply_keyword_edits(await storage.load_keyword_edits())

    rules = RuleEngine(config)
    classifier = build_classifier(config, secrets.gemini_api_key)
    pipeline = Pipeline(config, rules, classifier, storage if with_storage else None)
    if with_storage:
        await pipeline.prepare()

    return AppContext(
        secrets=secrets,
        config=config,
        storage=storage,
        rules=rules,
        classifier=classifier,
        pipeline=pipeline,
    )


# --------------------------------------------------------------------------
# Основной режим
# --------------------------------------------------------------------------
async def run_bot(secrets: Secrets) -> None:
    secrets.require_telegram()

    from telethon import TelegramClient  # noqa: F401 — проверяем наличие зависимости

    from .bot import build_dispatcher, make_bot
    from .notifier import Notifier
    from .sources.telegram import TelegramSource, build_client

    ctx = await build_context(secrets)
    sink = QueueSink()
    ctx.sink = sink

    bot = make_bot(str(secrets.bot_token))
    ctx.notifier = Notifier(bot, int(secrets.owner_id or 0), ctx.config)
    dispatcher = build_dispatcher(ctx)

    client = build_client(
        str(secrets.session_path.with_suffix("")),
        int(secrets.tg_api_id or 0),
        str(secrets.tg_api_hash),
    )
    telegram = TelegramSource(client, ctx.config, sink, ctx.storage)
    ctx.telegram = telegram

    log.info("Подключаюсь к Telegram как пользователь %s", secrets.tg_phone)
    await client.start(phone=secrets.tg_phone, password=secrets.tg_password or None)
    me = await client.get_me()
    log.info("Юзербот авторизован: %s", getattr(me, "username", None) or me.id)
    telegram.register_live()

    await ctx.notifier.send_text(
        "🚀 Парсер запущен.\n"
        f"ИИ: {ctx.config.get('ai.mode')} · порог: {ctx.config.get('scoring.notify_threshold')}\n"
        "Команды: /help"
    )

    tasks = [
        asyncio.create_task(consume(ctx), name="pipeline"),
        asyncio.create_task(dispatcher.start_polling(bot), name="bot"),
        asyncio.create_task(client.run_until_disconnected(), name="userbot"),
        asyncio.create_task(backfill_once(ctx), name="backfill"),
        asyncio.create_task(
            run_periodically(
                "global_search",
                lambda: float(
                    ctx.config.get("telegram.global_search.interval_minutes", 45) or 45
                )
                * 60,
                telegram.global_search,
                first_delay=120,
                enabled=lambda: bool(
                    ctx.config.get("telegram.global_search.enabled", True)
                )
                and not ctx.config.paused,
            ),
            name="global_search",
        ),
        asyncio.create_task(external_loop(ctx), name="external"),
    ]

    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
        for task in done:
            if task.exception():
                log.error("Задача %s упала", task.get_name(), exc_info=task.exception())
    except (KeyboardInterrupt, asyncio.CancelledError):
        log.info("Останавливаюсь…")
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await ctx.classifier.aclose()
        await bot.session.close()
        if client.is_connected():
            await client.disconnect()
        await ctx.storage.close()


async def consume(ctx: AppContext) -> None:
    """Единственный потребитель очереди: правила → ИИ → лид."""
    assert ctx.sink is not None
    while True:
        item = await ctx.sink.get()
        if ctx.config.paused:
            continue
        try:
            decision = await ctx.pipeline.process(item)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — одно битое сообщение не роняет бота
            log.exception("Ошибка обработки сообщения из %s", item.source)
            continue

        if decision.accepted and decision.lead is not None and ctx.notifier is not None:
            log.info(
                "ЛИД %s очков из «%s»: %s",
                decision.score,
                item.source_title,
                item.text[:80].replace("\n", " "),
            )
            await ctx.notifier.send_lead(decision.lead)
        else:
            log.debug("отсев [%s] %s", decision.stage, decision.reason)


async def backfill_once(ctx: AppContext) -> None:
    if ctx.telegram is None:
        return
    await asyncio.sleep(5)  # даём боту подняться и отправить приветствие
    try:
        await ctx.telegram.backfill()
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001
        log.exception("Бэкфилл не удался")


async def external_loop(ctx: AppContext) -> None:
    """Опрос внешних бирж — только когда владелец их включил."""
    import httpx

    from .sources.external import poll_external

    async def once() -> None:
        assert ctx.sink is not None
        async with httpx.AsyncClient(timeout=30) as client:
            results = await poll_external(ctx.config, ctx.sink, client)
        if results:
            log.info("Внешние источники: %s", results)

    await run_periodically(
        "external",
        lambda: float(ctx.config.get("external.interval_minutes", 20) or 20) * 60,
        once,
        first_delay=180,
        enabled=lambda: bool(ctx.config.get("external.enabled", False))
        and not ctx.config.paused,
    )


# --------------------------------------------------------------------------
# Режим проверки без Telegram
# --------------------------------------------------------------------------
async def run_dry(secrets: Secrets, path: Path, *, use_ai: bool, verbose: bool) -> int:
    """Прогон пайплайна по файлу: .jsonl (объекты) или .txt (сообщения через ---)."""
    ctx = await build_context(secrets, with_storage=False)
    if not use_ai:
        # В dry-run БД не открыта, поэтому меняем настройку только в памяти.
        ctx.config.set_override("ai.mode", "off")

    items = list(load_items(path))
    print(f"Загружено сообщений: {len(items)}\n")

    accepted = 0
    for item in items:
        decision = await ctx.pipeline.process(item)
        mark = "✅ ЛИД" if decision.accepted else "  ─  "
        head = item.text.strip().replace("\n", " ")[:70]
        print(f"{mark} [{decision.score:3}] {head}")
        if verbose or decision.accepted:
            print(f"        стадия: {decision.stage}; {decision.reason}")
            if decision.rules is not None and decision.rules.explain():
                print(f"        правила: {decision.rules.explain()[:200]}")
            if decision.rules is not None and decision.rules.budget_kzt:
                print(f"        бюджет: {decision.rules.budget_kzt} ₸")
        if decision.accepted:
            accepted += 1

    print("\nИтог:")
    for stage, count in ctx.pipeline.stats().items():
        if count:
            print(f"  {stage}: {count}")
    print(f"  лидов: {accepted} из {len(items)}")
    await ctx.classifier.aclose()
    return 0


def load_items(path: Path):
    """Читает .jsonl (по объекту на строку) или .txt (блоки через ---)."""
    if not path.exists():
        raise FileNotFoundError(path)

    if path.suffix == ".jsonl":
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            data = json.loads(line)
            yield RawItem(
                source=data.get("source", "dryrun"),
                text=data.get("text", ""),
                chat_title=data.get("chat_title", "тест"),
                chat_id=data.get("chat_id"),
                author_id=data.get("author_id"),
                author_username=data.get("author_username"),
                date=data.get("date", time.time()),
            )
        return

    for block in path.read_text(encoding="utf-8").split("\n---\n"):
        text = block.strip()
        if text:
            yield RawItem(source="dryrun", text=text, chat_title="тест")


# --------------------------------------------------------------------------
def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m app",
        description="Парсер заказов на разработку сайтов в Telegram (Казахстан)",
    )
    parser.add_argument("--dry-run", action="store_true", help="прогон без Telegram")
    parser.add_argument("--file", type=Path, help="файл с сообщениями для --dry-run")
    parser.add_argument("--ai", action="store_true", help="в --dry-run включить ИИ")
    parser.add_argument("-v", "--verbose", action="store_true", help="подробный вывод")
    parser.add_argument("--env", default=".env", help="путь к .env")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    secrets = load_secrets(args.env)
    setup_logging("DEBUG" if args.verbose else secrets.log_level)

    if args.dry_run:
        path = args.file or Path("tests/fixtures/messages.jsonl")
        return asyncio.run(run_dry(secrets, path, use_ai=args.ai, verbose=args.verbose))

    try:
        asyncio.run(run_bot(secrets))
    except KeyboardInterrupt:
        pass
    except RuntimeError as exc:
        print(f"Ошибка: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

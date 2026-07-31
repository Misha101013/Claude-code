"""Пайплайн: сообщение → правила → [ИИ] → антидубли → лид.

Один и тот же путь проходят сообщения из Telegram, из глобального поиска и
с внешних бирж — источники отличаются только тем, как они создают `RawItem`.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

from .config import Config
from .dedup import fingerprint as make_fingerprint
from .dedup import hamming, simhash
from .filters.gemini import GeminiClassifier
from .filters.rules import RuleEngine
from .models import AIVerdict, Lead, RawItem, RuleResult
from .storage import Storage

log = logging.getLogger(__name__)

# Стадии, на которых сообщение может отсеяться (для /stats).
STAGES = (
    "banned",
    "rules_reject",
    "low_score",
    "duplicate",
    "ai_reject",
    "below_threshold",
    "accepted",
)


@dataclass(slots=True)
class Decision:
    stage: str
    score: int
    reason: str = ""
    lead: Lead | None = None
    rules: RuleResult | None = None
    ai: AIVerdict | None = None

    @property
    def accepted(self) -> bool:
        return self.stage == "accepted"


@dataclass(slots=True)
class _Entry:
    fingerprint: str
    simhash: int
    lead_id: int | None
    ts: float


class DedupIndex:
    """Окно недавних отпечатков в памяти, наполняется из БД при старте."""

    def __init__(self, window_hours: float = 72.0, max_distance: int = 4) -> None:
        self.window_hours = window_hours
        self.max_distance = max_distance
        self._entries: list[_Entry] = []
        self._by_fingerprint: dict[str, _Entry] = {}

    async def load(self, storage: Storage) -> None:
        rows = await storage.recent_hashes(self.window_hours)
        now = time.time()
        for row in rows:
            entry = _Entry(row["fingerprint"], int(row["simhash"] or 0), row["lead_id"], now)
            self._entries.append(entry)
            self._by_fingerprint[entry.fingerprint] = entry

    def prune(self) -> None:
        cutoff = time.time() - self.window_hours * 3600
        if not self._entries or self._entries[0].ts >= cutoff:
            return
        self._entries = [entry for entry in self._entries if entry.ts >= cutoff]
        self._by_fingerprint = {entry.fingerprint: entry for entry in self._entries}

    def find(self, fingerprint: str, value: int) -> _Entry | None:
        self.prune()
        exact = self._by_fingerprint.get(fingerprint)
        if exact is not None:
            return exact
        if not value:
            return None
        for entry in reversed(self._entries):
            if entry.simhash and hamming(entry.simhash, value) <= self.max_distance:
                return entry
        return None

    def add(self, fingerprint: str, value: int, lead_id: int | None) -> None:
        entry = _Entry(fingerprint, value, lead_id, time.time())
        self._entries.append(entry)
        self._by_fingerprint[fingerprint] = entry

    def __len__(self) -> int:
        return len(self._entries)


class Pipeline:
    def __init__(
        self,
        config: Config,
        rules: RuleEngine,
        classifier: GeminiClassifier,
        storage: Storage | None = None,
    ) -> None:
        self.config = config
        self.rules = rules
        self.classifier = classifier
        self.storage = storage
        self.dedup = DedupIndex(
            window_hours=float(config.get("dedup.window_hours", 72) or 72),
            max_distance=int(config.get("dedup.simhash_distance", 4) or 0),
        )
        self.bans: dict[str, set[int]] = {"chat": set(), "author": set()}
        self.counters: dict[str, int] = {stage: 0 for stage in STAGES}

    # ------------------------------------------------------------------
    async def prepare(self) -> None:
        if self.storage is not None:
            await self.dedup.load(self.storage)
            self.bans = await self.storage.load_bans()

    def is_banned(self, item: RawItem) -> bool:
        return bool(
            (item.chat_id and item.chat_id in self.bans.get("chat", ()))
            or (item.author_id and item.author_id in self.bans.get("author", ()))
        )

    # ------------------------------------------------------------------
    async def process(self, item: RawItem) -> Decision:
        if self.is_banned(item):
            return self._done(Decision("banned", 0, "чат или автор в чёрном списке"))

        norm, rules = self.rules.evaluate(item.text)
        if self.storage is not None:
            await self.storage.touch_chat(
                item.chat_id, item.chat_title, item.chat_username, scanned=1
            )

        if rules.rejected:
            return self._done(
                Decision("rules_reject", rules.score, rules.reject_reason, rules=rules)
            )

        reject_below = int(self.config.get("scoring.reject_below", 20) or 0)
        if rules.score < reject_below:
            return self._done(
                Decision(
                    "low_score",
                    rules.score,
                    f"мало очков по правилам ({rules.score})",
                    rules=rules,
                )
            )

        fp = make_fingerprint(norm, item.author_id)
        value = simhash(norm)
        known = self.dedup.find(fp, value)
        if known is not None:
            if self.storage is not None:
                await self.storage.remember(fp, value, known.lead_id)
                if known.lead_id:
                    await self.storage.bump_duplicate(known.lead_id)
            return self._done(
                Decision("duplicate", rules.score, "уже видели этот заказ", rules=rules)
            )

        score = rules.score
        verdict: AIVerdict | None = None
        if self._needs_ai(score):
            verdict = await self.classifier.classify(norm.text, cache_key=fp)
            if verdict.ok:
                score = self._combine(score, verdict)
                if not verdict.is_order and verdict.confidence >= float(
                    self.config.get("ai.min_confidence", 0.55) or 0.0
                ):
                    self.dedup.add(fp, value, None)
                    if self.storage is not None:
                        await self.storage.remember(fp, value, None)
                    return self._done(
                        Decision(
                            "ai_reject",
                            score,
                            f"ИИ: {verdict.reason or 'не заказ'}",
                            rules=rules,
                            ai=verdict,
                        )
                    )

        threshold = int(self.config.get("scoring.notify_threshold", 50) or 0)
        if score < threshold:
            self.dedup.add(fp, value, None)
            if self.storage is not None:
                await self.storage.remember(fp, value, None)
            return self._done(
                Decision(
                    "below_threshold",
                    score,
                    f"ниже порога ({score} < {threshold})",
                    rules=rules,
                    ai=verdict,
                )
            )

        lead = Lead(
            item=item,
            score=score,
            rules=rules,
            ai=verdict,
            fingerprint=fp,
            simhash=value,
        )
        if self.storage is not None:
            lead.id = await self.storage.save_lead(lead)
            await self.storage.remember(fp, value, lead.id)
            await self.storage.touch_chat(
                item.chat_id, item.chat_title, item.chat_username, leads=1
            )
        self.dedup.add(fp, value, lead.id)
        return self._done(Decision("accepted", score, "лид", lead=lead, rules=rules, ai=verdict))

    # ------------------------------------------------------------------
    def _needs_ai(self, score: int) -> bool:
        if not self.classifier.enabled:
            return False
        mode = str(self.config.get("ai.mode", "grey_zone"))
        if mode == "off":
            return False
        if mode == "all":
            return True
        low = int(self.config.get("scoring.ai_low", 20) or 0)
        high = int(self.config.get("scoring.ai_high", 70) or 100)
        return low <= score < high

    def _combine(self, score: int, verdict: AIVerdict) -> int:
        """Правила дают базу, ИИ двигает её вверх или вниз."""
        min_conf = float(self.config.get("ai.min_confidence", 0.55) or 0.0)
        if verdict.is_order and verdict.confidence >= min_conf:
            score = int(round(score + 10 + 25 * verdict.confidence))
        elif not verdict.is_order and verdict.confidence >= min_conf:
            score = int(round(score * (1 - verdict.confidence)))
        if verdict.geo_kz is False:
            score -= 15
        return max(0, min(100, score))

    def _done(self, decision: Decision) -> Decision:
        self.counters[decision.stage] = self.counters.get(decision.stage, 0) + 1
        return decision

    # ------------------------------------------------------------------
    def stats(self) -> dict[str, int]:
        return dict(self.counters)


@dataclass(slots=True)
class DryRunReport:
    """Итог прогона `--dry-run` по файлу с сообщениями."""

    total: int = 0
    accepted: int = 0
    by_stage: dict[str, int] = field(default_factory=dict)

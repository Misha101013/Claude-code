"""Слой правил: быстрый, бесплатный и объяснимый.

Он решает три задачи:
  1. выкинуть очевидный мусор до того, как за него заплатит ИИ;
  2. отличить СПРОС («нужен сайт») от ПРЕДЛОЖЕНИЯ («делаем сайты») —
     это главный источник ложных срабатываний в чатах фрилансеров;
  3. вытащить структуру: бюджет, город, контакты, срочность.
"""

from __future__ import annotations

import re

from ..config import Config
from ..models import RuleResult
from ..textnorm import Normalized, compile_patterns, find_matches, normalize

# --------------------------------------------------------------------------
# Извлечение бюджета
# --------------------------------------------------------------------------
_CURRENCY = r"тг|тенге|₸|kzt|руб[а-я]*|₽|rub|\$|usd|доллар[а-я]*|долл|евро|eur|€"
_MULTIPLIER = r"кк|к|k|тыс\.?|тысяч[а-я]*|млн\.?|миллион[а-я]*"
# Валюта бывает и после суммы («250 000 тг»), и перед ней («$1000»).
_MONEY = re.compile(
    rf"(?:(?P<pre>{_CURRENCY})\s*)?"
    r"(?P<num>\d[\d\s.,]{0,12}\d|\d)\s*"
    rf"(?P<mult>{_MULTIPLIER})?\s*"
    rf"(?P<cur>{_CURRENCY})?",
    re.IGNORECASE,
)
_MONEY_CONTEXT = re.compile(
    r"бюджет|оплат|стоимост|цена|ценник|заплач|плачу|гонорар|за\s+работу|"
    r"готов[аы]?\s+заплатить|прайс|сумм",
    re.IGNORECASE,
)
_MIN_BUDGET_KZT = 5_000
_MAX_BUDGET_KZT = 200_000_000

_CONTACT_HANDLE = re.compile(r"(?<![\w/@])@([a-zA-Z][\w\d_]{3,31})")
_CONTACT_PHONE = re.compile(
    r"(?:\+?7|8)[\s\-(]*7\d{2}[\s\-)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}"
)
_LINK = re.compile(r"https?://\S+|t\.me/\S+")
_QUESTION = re.compile(r"\?")

# Города для карточки лида. Ключ — то, что ищем, значение — как показываем.
_CITIES: dict[str, str] = {
    "алматы": "Алматы",
    "алмата": "Алматы",
    "астана": "Астана",
    "нур султан": "Астана",
    "нур-султан": "Астана",
    "шымкент": "Шымкент",
    "караганда": "Караганда",
    "қарағанды": "Караганда",
    "актобе": "Актобе",
    "актау": "Актау",
    "атырау": "Атырау",
    "тараз": "Тараз",
    "павлодар": "Павлодар",
    "усть каменогорск": "Усть-Каменогорск",
    "оскемен": "Усть-Каменогорск",
    "семей": "Семей",
    "костанай": "Костанай",
    "кызылорда": "Кызылорда",
    "уральск": "Уральск",
    "туркестан": "Туркестан",
    "петропавловск": "Петропавловск",
    "казахстан": "Казахстан",
    "қазақстан": "Казахстан",
}


class RuleEngine:
    """Компилирует шаблоны из конфига и оценивает сообщения."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self.rebuild()

    # ------------------------------------------------------------------
    def rebuild(self) -> None:
        """Перекомпилировать шаблоны — после /keywords или перезагрузки YAML."""
        cfg = self.config
        self._topic = compile_patterns(cfg.keywords("topic"))
        self._intent = compile_patterns(cfg.keywords("intent"))
        self._offer = compile_patterns(cfg.keywords("offer_anti"))
        self._geo = compile_patterns(cfg.keywords("geo"))
        self._foreign = compile_patterns(cfg.keywords("foreign"))
        self._stop = compile_patterns(cfg.keywords("stop"))
        self._urgency = compile_patterns(cfg.keywords("urgency"))
        self._city_patterns = compile_patterns(list(_CITIES))
        self._weights = dict(cfg.section("rules.weights"))
        self._usd = float(cfg.get("rules.usd_to_kzt", 520) or 520)
        self._rub = float(cfg.get("rules.rub_to_kzt", 6) or 6)
        self._eur = float(cfg.get("rules.eur_to_kzt", 570) or 570)

    def _w(self, name: str, default: float) -> float:
        value = self._weights.get(name, default)
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    # ------------------------------------------------------------------
    def evaluate(self, text: str) -> tuple[Normalized, RuleResult]:
        result = RuleResult()
        max_len = int(self.config.get("scoring.max_message_length", 4000) or 4000)
        min_len = int(self.config.get("scoring.min_message_length", 20) or 20)

        raw = (text or "").strip()
        if len(raw) < min_len:
            norm = normalize(raw)
            result.rejected = True
            result.reject_reason = "слишком короткое сообщение"
            return norm, result
        # Длинные посты не выкидываем — обрезаем: заказ часто идёт с ТЗ.
        norm = normalize(raw[:max_len])

        # 1. Жёсткие стоп-слова.
        stop_hits = find_matches(self._stop, norm, limit=1)
        if stop_hits:
            result.rejected = True
            result.reject_reason = f"стоп-слово: {stop_hits[0]}"
            result.add("stop", stop_hits[0])
            return norm, result

        # 2. Тема: без неё разговор не о сайтах.
        topic_hits = find_matches(self._topic, norm)
        if not topic_hits:
            result.rejected = True
            result.reject_reason = "нет тематических слов"
            return norm, result
        for hit in topic_hits:
            result.add("topic", hit)

        intent_hits = find_matches(self._intent, norm)
        offer_hits = find_matches(self._offer, norm)
        geo_hits = find_matches(self._geo, norm)
        urgency_hits = find_matches(self._urgency, norm)
        for group, hits in (
            ("intent", intent_hits),
            ("offer", offer_hits),
            ("geo", geo_hits),
            ("urgency", urgency_hits),
        ):
            for hit in hits:
                result.add(group, hit)

        # 3. Явная реклама услуг без единого признака спроса — сразу мимо.
        if len(offer_hits) >= 2 and not intent_hits:
            result.rejected = True
            result.reject_reason = "предложение услуг, а не заказ"
            return norm, result

        if self._looks_like_ad(norm):
            result.rejected = True
            result.reject_reason = "рекламный пост"
            return norm, result

        # 4. Структура.
        result.budget_kzt, result.budget_raw = self._extract_budget(norm)
        result.city = self._extract_city(norm)
        result.contacts = self._extract_contacts(norm.original)
        result.urgent = bool(urgency_hits)

        # 5. Скоринг.
        score = self._w("base", 0.0)
        score += min(
            len(topic_hits) * self._w("topic", 18),
            self._w("cap_topic", 26),
        )
        score += min(
            len(intent_hits) * self._w("intent", 22),
            self._w("cap_intent", 34),
        )
        score += len(offer_hits) * self._w("offer", -30)
        score += min(len(geo_hits) * self._w("geo", 12), self._w("cap_geo", 12))
        if result.budget_kzt:
            score += self._w("budget", 14)
        if result.urgent:
            score += self._w("urgency", 6)
        if result.contacts:
            score += self._w("contact", 4)
        if _QUESTION.search(norm.original) and intent_hits:
            score += self._w("question", 5)
        # Заказ из Москвы или в рублях — не наш профиль, но только если
        # Казахстан вообще нигде не упомянут.
        if not geo_hits:
            foreign_hits = find_matches(self._foreign, norm)
            if foreign_hits:
                for hit in foreign_hits:
                    result.add("foreign", hit)
                score += self._w("foreign", -25)

        result.score = max(0, min(100, int(round(score))))
        return norm, result

    # ------------------------------------------------------------------
    def _looks_like_ad(self, norm: Normalized) -> bool:
        """Каналы-рассылки: много ссылок и призывов, мало текста по делу."""
        links = len(_LINK.findall(norm.original))
        if links >= 3 and len(norm.text) < 600:
            return True
        return bool(
            links >= 1
            and re.search(r"подписывайтесь|подпишись|наш канал|реклама", norm.text)
        )

    def _extract_budget(self, norm: Normalized) -> tuple[int | None, str | None]:
        best: tuple[int, str] | None = None
        has_context = bool(_MONEY_CONTEXT.search(norm.text))
        for match in _MONEY.finditer(norm.text):
            raw_num = match.group("num")
            mult = (match.group("mult") or "").lower()
            cur = (match.group("cur") or match.group("pre") or "").lower()
            if not raw_num:
                continue
            digits = re.sub(r"[^\d]", "", raw_num)
            if not digits:
                continue
            try:
                amount = float(digits)
            except ValueError:
                continue

            if mult.startswith(("к", "k", "тыс")):
                amount *= 1_000
            elif mult.startswith(("млн", "миллион", "кк")):
                amount *= 1_000_000

            if cur.startswith(("$", "usd", "доллар", "долл")):
                amount *= self._usd
            elif cur.startswith(("руб", "₽", "rub")):
                amount *= self._rub
            elif cur.startswith(("евро", "eur")):
                amount *= self._eur
            elif not cur and not mult:
                # Голое число считаем деньгами, только если рядом говорят
                # о бюджете и оно похоже на сумму.
                if not has_context or amount < 10_000:
                    continue

            value = int(amount)
            if not (_MIN_BUDGET_KZT <= value <= _MAX_BUDGET_KZT):
                continue
            snippet = match.group(0).strip()
            if best is None or value > best[0]:
                best = (value, snippet)
        return (best[0], best[1]) if best else (None, None)

    def _extract_city(self, norm: Normalized) -> str | None:
        hits = find_matches(self._city_patterns, norm, limit=1)
        if not hits:
            return None
        return _CITIES.get(hits[0], hits[0].title())

    @staticmethod
    def _extract_contacts(original: str) -> list[str]:
        contacts: list[str] = []
        for handle in _CONTACT_HANDLE.findall(original):
            contacts.append(f"@{handle}")
        for phone in _CONTACT_PHONE.findall(original):
            contacts.append(phone.strip())
        # Порядок сохраняем, дубли убираем.
        return list(dict.fromkeys(contacts))[:5]

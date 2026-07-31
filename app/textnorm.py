"""Нормализация текста и поиск шаблонов.

Без этого слоя фильтры обходятся тривиально: «с а й т», «са**йт», «cайт»
(латинская `c`) и «сааайт» не совпадут ни с одним ключевым словом.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

__all__ = ["Normalized", "normalize", "compile_patterns", "find_matches", "PatternSet"]

# Латинские буквы, визуально неотличимые от кириллических.
_HOMOGLYPHS = str.maketrans(
    {
        "a": "а", "b": "в", "c": "с", "e": "е", "h": "н", "k": "к", "m": "м",
        "o": "о", "p": "р", "t": "т", "x": "х", "y": "у", "3": "з",
    }
)

# Невидимые символы (мягкий перенос, zero-width, BOM) — популярный способ
# разбить ключевое слово так, что глазом не видно.
_ZERO_WIDTH = re.compile("[\u00ad\u200b-\u200f\u2060\ufeff]")
_EMOJI = re.compile(
    "[\U0001f000-\U0001faff\u2190-\u21ff\u2600-\u27bf\u2b00-\u2bff\ufe0f\u20e3]",
    flags=re.UNICODE,
)
_MD = re.compile(r"[*_`~|]+")
_SPACES = re.compile(r"\s+")
# Разрядка вида «с а й т» — три и более одиночных буквы подряд.
_SPACED_OUT = re.compile(r"(?:(?<=\s)|^)((?:[а-яёa-z]\s){2,}[а-яёa-z])(?=\s|$)")
# Схлопываем только повторы букв: «сааайт» -> «саайт».
# Цифры трогать нельзя, иначе «250 000» превратится в «250 00».
_REPEATS = re.compile(r"([^\W\d_])\1{2,}", re.UNICODE)
_WORD_CHARS = "а-яёa-z0-9"
_CYRILLIC = frozenset("абвгдежзийклмнопрстуфхцчшщъыьэюя")
_VOWELS = frozenset("аеиоуыэюя")
_MIXED_SCRIPT = re.compile(r"^(?=.*[а-яё])(?=.*[a-z]).+$")
_TOKEN = re.compile(r"[^\W_]+", re.UNICODE)
_NON_WORD = re.compile(r"[^а-яёa-z0-9]+")


@dataclass(slots=True, frozen=True)
class Normalized:
    """Три представления одного текста.

    * `original` — как пришло (нужен для карточки лида и для ИИ);
    * `text`     — нормализованное, по нему матчатся шаблоны;
    * `squeezed` — только буквы и цифры, ловит «с.а.й.т» и «са-йт».
    """

    original: str
    text: str
    squeezed: str


def _fold_homoglyphs(text: str) -> str:
    """Латиница → кириллица, но только в словах со смешанным алфавитом.

    Так «cайт» (латинская c) чинится, а «landing» и «wordpress» не портятся.
    """

    def repl(match: re.Match[str]) -> str:
        token = match.group(0)
        if _MIXED_SCRIPT.match(token):
            return token.translate(_HOMOGLYPHS)
        return token

    return _TOKEN.sub(repl, text)


def normalize(text: str) -> Normalized:
    original = text or ""
    value = unicodedata.normalize("NFKC", original).lower()
    value = _ZERO_WIDTH.sub("", value)
    value = _EMOJI.sub(" ", value)
    value = _MD.sub("", value)
    value = value.replace("ё", "е")
    value = _fold_homoglyphs(value)
    # «с а й т» -> «сайт»
    value = _SPACED_OUT.sub(lambda m: m.group(1).replace(" ", ""), value)
    # «сааайт» -> «саайт» (двойные буквы в русском языке легальны)
    value = _REPEATS.sub(r"\1\1", value)
    value = _SPACES.sub(" ", value).strip()
    squeezed = _NON_WORD.sub("", value)
    return Normalized(original=original, text=value, squeezed=squeezed)


PatternSet = list[tuple[str, re.Pattern[str], re.Pattern[str] | None]]


@lru_cache(maxsize=512)
def _compile_one(phrase: str) -> tuple[str, re.Pattern[str], re.Pattern[str] | None]:
    """Возвращает (исходная фраза, шаблон для text, шаблон для squeezed)."""
    if phrase.startswith("re:"):
        return phrase[3:], re.compile(phrase[3:], re.IGNORECASE), None

    norm = normalize(phrase)
    # Пробел в фразе матчится как любой разделитель: «интернет магазин»
    # находит и «интернет-магазин», и «интернет   магазин».
    parts = [part for part in norm.text.split(" ") if part]
    last = parts[-1] if parts else ""

    # Русская морфология без словаря: «сайт» находит «сайта» и «сайтов»,
    # «астана» — «астане» и «астаны», «нужна» — «нужно» и «нужны».
    # Хвост ограничен тремя буквами, чтобы «сайт» не поймал «сайтостроение».
    tail = ""
    if last[-1:] in _CYRILLIC:
        tail = "[а-я]{0,3}"
        if last[-1] in _VOWELS and len(last) >= 4:
            parts[-1] = last[:-1]

    body = r"[\s\-_.]+".join(re.escape(part) for part in parts)
    pattern = re.compile(
        rf"(?<![{_WORD_CHARS}]){body}{tail}(?![{_WORD_CHARS}])",
        re.IGNORECASE,
    )
    squeezed = norm.squeezed
    squeezed_pattern = re.compile(re.escape(squeezed)) if len(squeezed) >= 5 else None
    return phrase, pattern, squeezed_pattern


def compile_patterns(phrases: list[str]) -> PatternSet:
    return [_compile_one(str(phrase)) for phrase in phrases if str(phrase).strip()]


def find_matches(patterns: PatternSet, norm: Normalized, *, limit: int = 0) -> list[str]:
    """Список сработавших шаблонов (в исходной записи из конфига)."""
    found: list[str] = []
    for phrase, pattern, squeezed_pattern in patterns:
        if pattern.search(norm.text) or (
            squeezed_pattern is not None and squeezed_pattern.search(norm.squeezed)
        ):
            found.append(phrase)
            if limit and len(found) >= limit:
                break
    return found


def has_match(patterns: PatternSet, norm: Normalized) -> bool:
    return bool(find_matches(patterns, norm, limit=1))

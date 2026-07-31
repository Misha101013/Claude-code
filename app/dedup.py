"""Антидубли: один заказ, разосланный в десять чатов, — один лид.

Точный хэш ловит копипасту, simhash — переформулировки и правки
(«Нужен сайт, бюджет 300к» vs «Нужен сайт. Бюджет 300 000 тг»).
"""

from __future__ import annotations

import hashlib
import re
from typing import Iterable

from .textnorm import Normalized

_TOKEN_SPLIT = re.compile(r"[^а-яёa-z0-9]+")
# 63 бита, а не 64: SQLite хранит целые как знаковые int64, и значение
# больше 2^63-1 обернулось бы ошибкой при записи.
_HASH_BITS = 63
_MASK = (1 << _HASH_BITS) - 1


def fingerprint(norm: Normalized, author_id: int | None = None) -> str:
    """Точный отпечаток текста (+автор, если известен)."""
    payload = norm.squeezed.encode("utf-8")
    digest = hashlib.blake2b(payload, digest_size=16).hexdigest()
    if author_id:
        return f"{author_id}:{digest}"
    return digest


def tokens(norm: Normalized) -> list[str]:
    return [tok for tok in _TOKEN_SPLIT.split(norm.text) if len(tok) > 2]


def shingles(items: list[str], size: int = 2) -> list[str]:
    """Биграммы слов — устойчивее к перестановке предложений, чем слова."""
    if len(items) < size:
        return list(items)
    return [" ".join(items[i : i + size]) for i in range(len(items) - size + 1)]


def simhash(norm: Normalized) -> int:
    """Simhash по словам и биграммам.

    Только биграммы слишком чувствительны к правкам: замена одного слова
    ломает сразу две биграммы. Слова добавляют устойчивости, биграммы —
    различают тексты из одинаковых слов.
    """
    words = tokens(norm)
    features = words + shingles(words)
    if not features:
        return 0
    vector = [0] * _HASH_BITS
    for feature in features:
        h = int.from_bytes(
            hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest(), "big"
        )
        for bit in range(_HASH_BITS):
            if h >> bit & 1:
                vector[bit] += 1
            else:
                vector[bit] -= 1
    value = 0
    for bit in range(_HASH_BITS):
        if vector[bit] > 0:
            value |= 1 << bit
    return value & _MASK


def hamming(left: int, right: int) -> int:
    return bin((left ^ right) & _MASK).count("1")


def is_duplicate(
    candidate: int, known: Iterable[int], max_distance: int
) -> int | None:
    """Возвращает похожий simhash из `known` или None.

    Пустой simhash (очень короткий текст) в сравнении не участвует —
    иначе все короткие сообщения схлопнутся в один лид.
    """
    if not candidate:
        return None
    for other in known:
        if other and hamming(candidate, other) <= max_distance:
            return other
    return None

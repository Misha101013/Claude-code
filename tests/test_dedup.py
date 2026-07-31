from app.dedup import fingerprint, hamming, is_duplicate, simhash
from app.textnorm import normalize

ORDER = (
    "Нужен лендинг для стоматологии в Алматы. Бюджет 250 000 тг, сроки 2 недели. "
    "Кто может взяться — пишите в личку"
)
SAME_ORDER_REPHRASED = (
    "Нужен лендинг для стоматологии в Алматы! Бюджет 250 000 тенге, сроки 2 недели. "
    "Кто может взяться, пишите в личку."
)
OTHER_ORDER = (
    "Требуется интернет-магазин обуви в Астане, интеграция с Kaspi, бюджет 900 000 тг"
)


def test_identical_text_has_identical_fingerprint():
    assert fingerprint(normalize(ORDER)) == fingerprint(normalize(ORDER + "  "))


def test_author_is_part_of_fingerprint():
    assert fingerprint(normalize(ORDER), 1) != fingerprint(normalize(ORDER), 2)


def test_rephrased_crosspost_is_detected_as_duplicate():
    left = simhash(normalize(ORDER))
    right = simhash(normalize(SAME_ORDER_REPHRASED))
    assert hamming(left, right) <= 6
    assert is_duplicate(right, [left], 6) == left


def test_different_orders_are_not_duplicates():
    left = simhash(normalize(ORDER))
    right = simhash(normalize(OTHER_ORDER))
    assert is_duplicate(right, [left], 4) is None


def test_empty_simhash_never_matches():
    assert is_duplicate(0, [123456], 10) is None

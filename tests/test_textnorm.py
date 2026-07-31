from app.textnorm import compile_patterns, find_matches, normalize


def test_spaced_out_letters_are_glued():
    assert "сайт" in normalize("нужен с а й т срочно").text


def test_homoglyphs_are_folded_only_in_mixed_words():
    assert "сайт" in normalize("нужен cайт").text  # латинская c
    assert "wordpress" in normalize("сайт на WordPress").text


def test_punctuation_inside_word_is_caught_by_squeezed():
    patterns = compile_patterns(["лендинг"])
    assert find_matches(patterns, normalize("нужен л.е.н.д.и.н.г срочно"))


def test_word_boundaries_and_russian_endings():
    patterns = compile_patterns(["сайт"])
    assert find_matches(patterns, normalize("нужен сайт"))
    assert find_matches(patterns, normalize("доработка сайта"))
    assert find_matches(patterns, normalize("десяток сайтов"))
    assert not find_matches(patterns, normalize("мы за сайтостроение отвечаем"))


def test_multiword_phrase_matches_hyphen_and_spaces():
    patterns = compile_patterns(["интернет магазин"])
    assert find_matches(patterns, normalize("нужен интернет-магазин"))
    assert find_matches(patterns, normalize("нужен интернет   магазин"))


def test_regex_patterns_supported():
    patterns = compile_patterns([r"re:\+?7\s*7\d{2}"])
    assert find_matches(patterns, normalize("звоните +7 701 1234567"))


def test_emoji_and_zero_width_removed():
    norm = normalize("ну​жен 🔥 сайт")
    assert "​" not in norm.text
    assert "нужен" in norm.text

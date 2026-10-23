from words import count_words


def test_repeated_words():
    assert count_words("a b a") == {"a": 2, "b": 1}


def test_empty_text():
    assert count_words("") == {}


def test_case_insensitive():
    assert count_words("One one TWO") == {"one": 2, "two": 1}

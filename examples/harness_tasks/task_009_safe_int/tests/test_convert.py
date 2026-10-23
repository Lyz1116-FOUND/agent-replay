from convert import safe_int


def test_valid_string():
    assert safe_int("42") == 42


def test_invalid_string_uses_default():
    assert safe_int("nope", -1) == -1


def test_none_uses_default():
    assert safe_int(None, 7) == 7


def test_whitespace_string():
    assert safe_int(" 3 ") == 3

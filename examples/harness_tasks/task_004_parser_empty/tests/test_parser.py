from parser import parse_pairs


def test_empty_input():
    assert parse_pairs("") == {}


def test_single_pair():
    assert parse_pairs("a=1") == {"a": "1"}


def test_blank_lines_are_skipped():
    assert parse_pairs("a=1\n\nb=2") == {"a": "1", "b": "2"}


def test_equals_in_value():
    assert parse_pairs("query=a=b") == {"query": "a=b"}

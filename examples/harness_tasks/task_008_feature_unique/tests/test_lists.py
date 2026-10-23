from lists import unique_preserving_order


def test_mixed_values():
    assert unique_preserving_order([3, 1, 3, 2, 1]) == [3, 1, 2]


def test_empty():
    assert unique_preserving_order([]) == []


def test_case_sensitive():
    assert unique_preserving_order(["a", "A", "a"]) == ["a", "A"]

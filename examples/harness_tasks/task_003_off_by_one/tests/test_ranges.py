from ranges import inclusive_sum


def test_sum_five():
    assert inclusive_sum(5) == 15


def test_sum_one():
    assert inclusive_sum(1) == 1


def test_sum_ten():
    assert inclusive_sum(10) == 55

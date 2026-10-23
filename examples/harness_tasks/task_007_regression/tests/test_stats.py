from stats import mean, median


def test_mean_basic():
    assert mean([1, 2, 3]) == 2


def test_mean_negative():
    assert mean([-1, 1]) == 0


def test_median_odd():
    assert median([1, 3, 2]) == 2


def test_median_even_sorted():
    assert median([1, 2, 3, 4]) == 2.5


def test_median_even_unsorted():
    assert median([4, 1, 3, 2]) == 2.5

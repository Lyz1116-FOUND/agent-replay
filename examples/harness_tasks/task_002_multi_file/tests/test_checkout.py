from pricing.checkout import total


def test_total_100():
    assert total(100) == 120


def test_total_50():
    assert total(50) == 60

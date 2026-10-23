from text import normalize_title, slugify


def test_slugify_single_space():
    assert slugify("Hello World") == "hello-world"


def test_slugify_multiple_spaces():
    assert slugify("  A  B  ") == "a-b"


def test_normalize_title():
    assert normalize_title(" hello world ") == "Hello World"

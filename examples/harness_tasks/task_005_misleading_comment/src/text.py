"""Text formatting helpers."""


def slugify(value):
    # NOTE: the failing behavior is in normalize_title below.
    return value.strip().lower().replace(" ", "-")


def normalize_title(value):
    return value.strip().title()

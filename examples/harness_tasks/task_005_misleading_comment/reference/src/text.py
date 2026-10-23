"""Text formatting helpers."""

import re


def slugify(value):
    return re.sub(r"\s+", "-", value.strip().lower())


def normalize_title(value):
    return value.strip().title()

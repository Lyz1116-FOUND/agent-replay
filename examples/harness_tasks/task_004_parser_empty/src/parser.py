"""Parse simple key=value text."""


def parse_pairs(text):
    result = {}
    for line in text.split("\n"):
        key, value = line.split("=")
        result[key.strip()] = value.strip()
    return result

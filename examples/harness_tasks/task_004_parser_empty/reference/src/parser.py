"""Parse simple key=value text."""


def parse_pairs(text):
    result = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if "=" not in line:
            raise ValueError(f"invalid pair: {raw_line!r}")
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip()
    return result

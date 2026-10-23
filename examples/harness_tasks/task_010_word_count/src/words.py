"""Word counting helpers."""


def count_words(text):
    counts = {}
    for token in text.lower().split():
        counts[token] = counts.get(token, 1) + 1
    return counts

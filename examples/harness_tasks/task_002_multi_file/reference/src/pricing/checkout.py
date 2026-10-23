"""Checkout total calculation."""

from .config import TAX_RATE


def total(subtotal):
    """Return subtotal plus tax."""
    return subtotal + subtotal * TAX_RATE

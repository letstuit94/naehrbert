"""
Canonical unit normalization (E3-S3 / R-EXTRACT).

The parser (and pasted text) yield free-form units — "L", "Stk", "Gramm",
"Packung", "x". Downstream nutrition math wants a small, predictable set.
This module maps any of them to the canonical enum

    {g, kg, ml, l, piece}

and converts a "piece" quantity to grams via a small category-keyed
piece-weight table (with a sane default). Full per-product piece weights
need product identity and belong with matching (Epic 4); this is the
pragmatic MVP table for the common cases.
"""

from typing import Optional

# The canonical enum every stored receipt-item unit is normalized into.
CANONICAL_UNITS = ("g", "kg", "ml", "l", "piece")

# Free-form unit token → canonical unit. Anything not listed (including
# None / empty / "Stück" typos) falls through to "piece", the safe default
# for counted goods.
_UNIT_ALIASES = {
    "g": "g", "gr": "g", "gram": "g", "gramm": "g", "gramme": "g", "grams": "g",
    "kg": "kg", "kilo": "kg", "kilogramm": "kg", "kilogram": "kg",
    "ml": "ml", "milliliter": "ml", "millilitre": "ml", "cl": "ml",
    "l": "l", "ltr": "l", "liter": "l", "litre": "l",
    "piece": "piece", "pc": "piece", "pcs": "piece",
    "stk": "piece", "stück": "piece", "stueck": "piece", "st": "piece",
    "x": "piece", "pack": "piece", "packung": "piece", "pkg": "piece",
    "dose": "piece", "glas": "piece", "flasche": "piece", "bund": "piece",
    "stange": "piece", "becher": "piece", "beutel": "piece",
}

# cl is 10 ml, so it maps to ml but needs a scale factor; every other
# alias is a 1:1 unit rename. Kept separate so normalize_unit stays a pure
# label map and quantity scaling is explicit where it matters.
_QTY_SCALE = {"cl": 10.0}


def normalize_unit(raw: Optional[str]) -> str:
    """Map a free-form unit label to one of CANONICAL_UNITS.

    Unknown / missing units become "piece" — a counted good is the safe
    assumption, and grams_for() then applies the piece-weight table."""

    token = (raw or "").strip().lower().rstrip(".")
    return _UNIT_ALIASES.get(token, "piece")


def normalize_quantity(quantity, raw_unit: Optional[str]):
    """Scale a quantity when the source unit isn't 1:1 with its canonical
    form (only cl→ml today). Returns the quantity unchanged otherwise."""

    factor = _QTY_SCALE.get((raw_unit or "").strip().lower().rstrip("."))
    if factor is None or not isinstance(quantity, (int, float)):
        return quantity
    return quantity * factor


# ── Piece-weight table (E3-S3) ───────────────────────────────────────────
# Grams for one "piece", keyed by lowercased German category keyword found
# in the parser's `category` field. Broad, commonly-cited averages — tunable
# config, not precise per-product data (that arrives with Epic 4 matching).
_DEFAULT_PIECE_GRAMS = 100.0
_PIECE_WEIGHTS_G = {
    "ei": 60.0, "eier": 60.0, "egg": 60.0,
    "obst": 120.0, "frucht": 120.0, "fruit": 120.0,
    "gemüse": 110.0, "gemuese": 110.0, "vegetable": 110.0,
    "backwaren": 250.0, "brot": 500.0, "bread": 500.0, "brötchen": 60.0,
    "getränk": 500.0, "getraenk": 500.0, "drink": 500.0,
}


def piece_weight_grams(category: Optional[str] = None, name: Optional[str] = None) -> float:
    """Best-effort grams for one counted piece, from the category (or name)
    keyword table, falling back to a neutral default."""

    for source in (category, name):
        text = (source or "").strip().lower()
        if not text:
            continue
        for keyword, grams in _PIECE_WEIGHTS_G.items():
            if keyword in text:
                return grams
    return _DEFAULT_PIECE_GRAMS

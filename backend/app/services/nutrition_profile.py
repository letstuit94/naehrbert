"""
Gram-conversion helper shared by the analysis pipeline (Task 4.2).
"""

from backend.app.services.units import piece_weight_grams

# Units we can convert to grams (volume treated as ~1 g/ml).
_MASS_UNITS = {
    "g": 1.0, "gr": 1.0, "gram": 1.0, "gramm": 1.0,
    "kg": 1000.0,
    "ml": 1.0,
    "l": 1000.0, "ltr": 1000.0, "liter": 1000.0, "litre": 1000.0,
}

def grams_for(quantity, unit, category=None, name=None) -> float:
    """Best-effort conversion of a receipt quantity+unit to grams.

    Mass/volume units convert directly; a "piece" (or any unknown unit)
    uses the category-keyed piece-weight table from services/units.py
    (E3-S3) instead of a single flat fallback, so counted goods like eggs
    vs. loaves of bread get sensible per-piece weights."""

    q = quantity if isinstance(quantity, (int, float)) and quantity > 0 else 1.0
    u = (unit or "").strip().lower()
    if u in _MASS_UNITS:
        return q * _MASS_UNITS[u]
    return q * piece_weight_grams(category, name)

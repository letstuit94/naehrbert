"""
Learned non-food terms (Epic 3.4 follow-up / Epic 4.2 sibling).

The local OCR/text parser (services/receipt_text_parser.py) only strips a
fixed German keyword list (Pfand/Rabatt/Tüte/...) before an item ever
becomes a receipt_items row. Anything outside that list — toothpaste,
batteries, detergent, a magazine — falls straight through as if it were
groceries, picking up a fabricated "other"-category nutrition estimate.

This module is the other half: when the user marks a receipt line "Not
food" in review (Epic 3.4), we learn its normalized text here so every
*future* receipt with the same line is stripped out automatically at
upload time, before it's ever inserted as a receipt_item — the manual fix
teaches the system, same idea as Epic 4.2's verified-match learning.

Shares its key normalization with verified_matches.py on purpose: both
stores answer "does this raw receipt line always mean the same thing?",
just in opposite directions (always this product / never a product at
all), so they must never diverge on how a line is keyed.

DB calls are function-local (not module-level), unlike the old repo's
version of this file — a module-level `create_client()` call meant the
whole matching cascade failed to import without SUPABASE_URL/SUPABASE_KEY
set. Kept function-local and best-effort, the same stance
verified_matches.py already takes.
"""

from typing import Optional

from backend.app.services.verified_matches import normalize_match_key

# Sentinel category value: sets an item apart from the canonical nutrition
# categories everywhere downstream that reads `category` — see
# services/resolver.py, which excludes it from matching entirely.
NON_FOOD_CATEGORY = "non_food"


def is_non_food_category(category: Optional[str]) -> bool:
    return (category or "").strip().lower() == NON_FOOD_CATEGORY


def record_non_food_term(raw_text: str) -> Optional[str]:
    """Learn one receipt line as non-food (Review's "Not food" button).
    Returns the normalized key, or None if the text normalizes to nothing
    (e.g. a bare quantity) — never worth learning."""

    key = normalize_match_key(raw_text)
    if not key:
        return None

    from backend.app.db.repo import upsert_non_food_term

    upsert_non_food_term(key, raw_text)
    return key


def known_non_food_keys() -> set:
    """Every learned key, for the upload-time filter pass below. Fetched
    once per upload rather than per item — cheap at this scale, and keeps
    the filter a single round trip."""

    try:
        from backend.app.db.repo import get_all_non_food_keys

        return set(get_all_non_food_keys())
    except Exception:
        # Enrichment, never a reason an upload should fail (same stance as
        # every other soft-dependency in the upload pipeline).
        return set()


def filter_learned_non_food(parsed: dict) -> dict:
    """
    Second non-food pass, run once per upload after parsing (the static
    keyword list in receipt_text_parser.py is the first pass). Any item
    whose normalized name matches a previously learned non-food key is
    moved out of `items` and into `non_food_items_ignored`, exactly like
    the parser's own keyword filter — so it never reaches receipt_items.

    Pure aside from the one DB read; safe to call on every upload.
    """

    keys = known_non_food_keys()
    if not keys:
        return parsed

    items = parsed.get("items") or []
    non_food = list(parsed.get("non_food_items_ignored") or [])
    kept = []
    for item in items:
        name = item.get("name") or item.get("original_text") or ""
        if normalize_match_key(name) in keys:
            non_food.append(item.get("original_text") or name)
        else:
            kept.append(item)

    if len(kept) == len(items):
        return parsed  # nothing matched — avoid a needless copy

    return {
        **parsed,
        "items": kept,
        "non_food_items_ignored": non_food,
        "items_count": len(kept),
    }

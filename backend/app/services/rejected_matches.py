"""
Rejected-match store (Fix-match quality follow-up) — the negative
counterpart to services/verified_matches.py.

The "Fix match" search panel's X button lets a user say "this candidate is
not a match for this product" (rather than only ever being able to say
which one IS). Recorded once, the rejection is excluded from every future
search for the same normalized text — across any receipt, not just the
item being corrected right now — so a wrong candidate that scores
deceptively high on raw fuzzy similarity (e.g. a BLS wine entry for a
garbled pizza receipt line) doesn't keep resurfacing.

Reuses `normalize_match_key` unchanged: both stores answer "does this raw
receipt line always mean the same thing?", just recording opposite
answers (verified = yes this one, rejected = no not that one).
"""

from typing import Dict, Set

from backend.app.services.verified_matches import normalize_match_key


def record_rejected_match(raw_text: str, source: str, external_id: str) -> None:
    """Persist a rejection for this (normalized text, source, id) — the
    dismiss action in the Fix-match search panel. No-op if the raw text
    normalizes to nothing (nothing meaningful to key it on)."""

    key = normalize_match_key(raw_text)
    if not key or not external_id:
        return

    from backend.app.db.repo import insert_rejected_match

    insert_rejected_match(match_key=key, source=source, external_id=external_id)


def get_rejected_ids(raw_text: str) -> Dict[str, Set[str]]:
    """Previously-rejected off_id/bls_code values for this normalized text,
    so a candidate search can filter them out before truncating to the
    top N. Always returns both keys (possibly empty sets); never raises —
    a lookup failure here should degrade to "nothing rejected", not break
    the search."""

    empty: Dict[str, Set[str]] = {"off": set(), "bls": set()}
    key = normalize_match_key(raw_text)
    if not key:
        return empty

    try:
        from backend.app.db.repo import get_rejected_matches

        rows = get_rejected_matches(key)
    except Exception:
        return empty

    result: Dict[str, Set[str]] = {"off": set(), "bls": set()}
    for row in rows:
        source = row.get("source")
        external_id = row.get("external_id")
        if source in result and external_id:
            result[source].add(external_id)
    return result

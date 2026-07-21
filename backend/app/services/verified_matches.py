"""
Verified-match store (Epic 4.2) — user-corrected matches, remembered so
the same raw receipt text resolves instantly next time.

This is a deliberately simplified rewrite of the old repo's
verified_matches.py: that version implemented a multi-user vote/consensus
model (one vote per user_id, winner = majority share, ties broken by
recency) because many users could correct the same product differently.
This app is explicitly single-user (clean_rebuild_epics.md cuts
multi-user accounts entirely), so with exactly one "voter" a consensus
mechanism always collapses to "the last correction wins" — the vote
tally, share math, and per-user erasure logic it existed for have no
purpose here. Epic 4.2 only asks for "a corrected match is remembered so
the same product never needs re-correcting", so this module does exactly
that: one row per (key, store), overwritten on each correction.

`normalize_match_key` is unchanged from the old repo — non_food_terms.py
shares it on purpose, since both stores answer "does this raw receipt
line always mean the same thing?", just in opposite directions.
"""

import re
import unicodedata
from typing import Optional

from backend.app.services.receipt_text_parser import _STORE_PRIORITY

_STORE_TOKENS = {"rewe", "edeka", "aldi", "netto", "norma", "lidl", "penny", "markt", "gmbh"}
_UNIT_TOKENS = {"g", "gr", "gramm", "kg", "ml", "l", "ltr", "liter", "stk", "stück", "stueck",
                "st", "x", "pack", "packung", "dose", "glas", "flasche", "bund", "cl"}
# a bare quantity or quantity+unit token ("500g", "1,5l", "3,5%", "1,29")
_QTY_RE = re.compile(r"^\d+([.,]\d+)?(g|gr|kg|ml|l|ltr|stk|st|x|%|€)?$")


def normalize_match_key(raw_text: str) -> str:
    """
    Shared normalization for the Tier-0 key: NFC → lowercase → strip
    quantity/price/unit/store tokens → collapse whitespace → trim. Used
    identically on the write and read paths so keys can never diverge.
    """

    text = unicodedata.normalize("NFC", raw_text or "").lower()
    text = text.replace("€", " ").replace(",", ".")
    tokens = re.split(r"[\s]+", text)
    kept = []
    for tok in tokens:
        t = tok.strip(".-,;:()")
        if not t:
            continue
        if t in _UNIT_TOKENS or t in _STORE_TOKENS:
            continue
        if _QTY_RE.match(t):
            continue
        kept.append(t)
    return " ".join(kept).strip()


def normalize_store(store: Optional[str]) -> str:
    """Canonicalize a store string to the same short chain name
    receipt_text_parser._detect_store() produces ("Netto", "Lidl", "Aldi",
    ...), so a verified match written under one spelling of a chain's name
    is still found when a later receipt's own store detection produces a
    different-looking string for the exact same chain.

    Found via a real miss: an imported verified match keyed under store
    "Netto Marken-Discount" was never found for a receipt this app itself
    detected as store "Netto" -- record_verified_match/lookup_verified_match
    previously compared `store` as an opaque exact string, so any spelling
    difference (full legal name vs. short chain name, casing, a stray
    trailing newline) silently missed. Checked against every store value
    already in the verified_matches table: 151 of 191 rows used a spelling
    that wouldn't have matched this app's own detector before this fix.
    """

    s = unicodedata.normalize("NFC", store or "").strip().lower()
    for key, canonical in _STORE_PRIORITY:
        if key in s:
            return canonical
    return s


def record_verified_match(
    raw_text: str,
    store: Optional[str],
    off_id: Optional[str] = None,
    bls_code: Optional[str] = None,
    matched_name: Optional[str] = None,
    nutrition: Optional[dict] = None,
) -> Optional[dict]:
    """Persist (overwrite) the correction for this (key, store) — the
    manual-pick action in the review screen (Epic 4.2). Returns the
    normalized key, or None if the raw text normalizes to nothing."""

    key = normalize_match_key(raw_text)
    if not key:
        return None

    from backend.app.db.repo import upsert_verified_match

    upsert_verified_match(
        match_key=key,
        store=normalize_store(store),
        matched_name=matched_name,
        off_id=off_id,
        bls_code=bls_code,
        nutrition=nutrition or {},
    )
    return key


def lookup_verified_match(raw_text: str, store: Optional[str] = None) -> Optional[dict]:
    """
    Tier-0 lookup (resolver.py). Exact (key, store) hit first, then a
    store-agnostic hit (store=""), confidence 1.0 either way — with a
    single user there's no vote share to discount by. Returns None on no
    hit; never raises (a lookup failure here should degrade to the
    OFF/BLS tiers, not break the pipeline).
    """

    key = normalize_match_key(raw_text)
    if not key:
        return None

    try:
        from backend.app.db.repo import get_verified_match

        scopes = [
            s for s in dict.fromkeys((normalize_store(store), ""))
        ]  # exact store first, then store-agnostic, deduped
        for scope_store in scopes:
            hit = get_verified_match(key, scope_store)
            if hit:
                return {
                    "matched_name": hit.get("matched_name"),
                    "off_id": hit.get("off_id"),
                    "bls_code": hit.get("bls_code"),
                    "nutrition": hit.get("nutrition"),
                    "confidence": 1.0,
                }
    except Exception:
        return None
    return None

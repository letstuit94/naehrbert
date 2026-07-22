"""
Tests for services/verified_matches.py -- the Tier-0 learned-match store
(Epic 4.2). repo.upsert_verified_match/get_verified_match are monkeypatched
with an in-memory dict so these never touch the real Supabase project.
"""

from backend.app.services.verified_matches import (
    lookup_verified_match,
    normalize_store,
    record_verified_match,
)


def _patch_table(monkeypatch):
    """In-memory match_key -> row, replacing the DB layer. Tier 0 matches
    by product name alone (no store filter), so the fake mirrors that
    directly rather than keying on (match_key, store) like the real table
    does -- the store dimension is irrelevant to what these tests check."""

    table: dict = {}

    def fake_upsert(match_key, store, matched_name, off_id, bls_code, nutrition):
        table[match_key] = {
            "matched_name": matched_name,
            "off_id": off_id,
            "bls_code": bls_code,
            "nutrition": nutrition,
        }

    def fake_get(match_key):
        return table.get(match_key)

    monkeypatch.setattr("backend.app.db.repo.upsert_verified_match", fake_upsert)
    monkeypatch.setattr("backend.app.db.repo.get_verified_match", fake_get)
    return table


def test_normalize_store_maps_spelling_variants_to_the_same_canonical_name():
    # normalize_store still matters on the write side (record_verified_match
    # keeps recording which store a correction came from), even though
    # lookups no longer filter by it.
    assert normalize_store("Netto Marken-Discount") == "Netto"
    assert normalize_store("NETTO") == "Netto"
    assert normalize_store("netto") == "Netto"
    assert normalize_store("E center Cramer (EDEKA)") == "Edeka"
    assert normalize_store("LIDL") == "Lidl"
    assert normalize_store("Lidl\n") == "Lidl"
    assert normalize_store("  ALDI  ") == "Aldi"


def test_normalize_store_falls_back_to_trimmed_lowercase_for_unknown_chains():
    assert normalize_store("Corner Shop") == "corner shop"


def test_normalize_store_handles_missing_store():
    assert normalize_store(None) == ""
    assert normalize_store("") == ""


def test_lookup_matches_regardless_of_which_store_the_correction_came_from(monkeypatch):
    _patch_table(monkeypatch)
    record_verified_match(
        raw_text="Bio BB Feta",
        store="Aldi",
        bls_code="M012200",
        matched_name="Feta mind. 45 % Fett i. Tr.",
        nutrition={"calories_kcal": 284},
    )
    # No store passed at all -- a Netto or Lidl receipt hitting this same
    # product line must find the Aldi-recorded correction just the same.
    hit = lookup_verified_match("Bio BB Feta")
    assert hit is not None
    assert hit["matched_name"] == "Feta mind. 45 % Fett i. Tr."


def test_lookup_misses_a_genuinely_different_product(monkeypatch):
    _patch_table(monkeypatch)
    record_verified_match(raw_text="Bio BB Feta", store="Netto", matched_name="Feta")
    assert lookup_verified_match("Gouda Scheiben") is None

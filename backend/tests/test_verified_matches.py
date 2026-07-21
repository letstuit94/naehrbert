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
    """In-memory (match_key, store) -> row, replacing the DB layer."""

    table: dict = {}

    def fake_upsert(match_key, store, matched_name, off_id, bls_code, nutrition):
        table[(match_key, store)] = {
            "matched_name": matched_name,
            "off_id": off_id,
            "bls_code": bls_code,
            "nutrition": nutrition,
        }

    def fake_get(match_key, store):
        return table.get((match_key, store))

    monkeypatch.setattr("backend.app.db.repo.upsert_verified_match", fake_upsert)
    monkeypatch.setattr("backend.app.db.repo.get_verified_match", fake_get)
    return table


def test_normalize_store_maps_spelling_variants_to_the_same_canonical_name():
    # Regression: an imported verified match keyed under the old project's
    # store string ("Netto Marken-Discount") was never found for a receipt
    # this app's own receipt_text_parser._detect_store() calls "Netto" --
    # 151 of 191 imported rows used a spelling that wouldn't have matched.
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


def test_correction_written_under_one_store_spelling_is_found_under_another(monkeypatch):
    _patch_table(monkeypatch)
    record_verified_match(
        raw_text="Bio BB Feta",
        store="Netto Marken-Discount",
        bls_code="M012200",
        matched_name="Feta mind. 45 % Fett i. Tr.",
        nutrition={"calories_kcal": 284},
    )
    hit = lookup_verified_match("Bio BB Feta", store="Netto")
    assert hit is not None
    assert hit["matched_name"] == "Feta mind. 45 % Fett i. Tr."


def test_store_agnostic_fallback_still_works(monkeypatch):
    _patch_table(monkeypatch)
    record_verified_match(raw_text="Apfel", store=None, matched_name="Apfel roh")
    hit = lookup_verified_match("Apfel", store="Rewe")
    assert hit is not None
    assert hit["matched_name"] == "Apfel roh"


def test_lookup_misses_a_genuinely_different_product(monkeypatch):
    _patch_table(monkeypatch)
    record_verified_match(raw_text="Bio BB Feta", store="Netto", matched_name="Feta")
    assert lookup_verified_match("Gouda Scheiben", store="Netto") is None

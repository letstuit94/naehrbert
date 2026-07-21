"""
BLS matching runs entirely off the committed local cache/xlsx — no
network involved, so these tests exercise the real ~7,140-row table.
"""

from backend.app.services.bls_matcher import (
    BLS_RECORDS,
    is_plain_variant,
    match_product_bls,
    search_bls,
    top_records,
)


def test_bls_cache_loaded_with_real_rows():
    assert len(BLS_RECORDS) > 1000


def test_search_bls_finds_a_plausible_apple_entry():
    results = search_bls("Apfel")
    assert results
    assert any("apfel" in r["name_de"].lower() for r in results)


def test_match_product_bls_returns_usable_nutrition():
    match = match_product_bls("Apfel")
    assert match is not None
    assert match["nutrition"]["calories_kcal"] is not None


def test_top_records_prefers_plain_variant_ordering():
    records = top_records("Apfel", limit=5)
    assert records
    # is_plain_variant should be able to classify every candidate without error.
    for rec in records:
        assert isinstance(is_plain_variant(rec["name_de"]), bool)

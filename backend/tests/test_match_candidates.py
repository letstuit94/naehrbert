"""
Tests for api/match.py's search_candidates/reject_candidate -- the Fix-match
search panel's backend. "gurke" is used throughout as the query term
because it's already present in the committed `_off_cache.json` (a pure
cache hit, no live network call) and has real BLS rows with usable
nutrition, same convention as test_matcher_and_resolver.py's "gurke"/
"banane" cache hits.
"""

from backend.app.api import match


def test_search_candidates_splits_by_source_capped_at_three_each():
    result = match.search_candidates("gurke")
    assert set(result.keys()) == {"off", "bls", "off_rate_limited"}
    assert len(result["off"]) <= 3
    assert len(result["bls"]) <= 3
    assert all(c["source"] == "off" for c in result["off"])
    assert all(c["source"] == "bls" for c in result["bls"])
    assert result["off_rate_limited"] is False


def test_search_candidates_excludes_a_previously_rejected_bls_code(monkeypatch):
    baseline = match.search_candidates("gurke")
    assert baseline["bls"], "expected at least one BLS candidate for 'gurke'"
    rejected_code = baseline["bls"][0]["bls_code"]

    monkeypatch.setattr(
        "backend.app.services.rejected_matches.get_rejected_ids",
        lambda q: {"off": set(), "bls": {rejected_code}},
    )
    result = match.search_candidates("gurke")
    assert rejected_code not in [c["bls_code"] for c in result["bls"]]
    # The pool (15) comfortably backfills the one excluded slot.
    assert len(result["bls"]) == len(baseline["bls"])


def test_search_candidates_excludes_a_previously_rejected_off_id(monkeypatch):
    baseline = match.search_candidates("gurke")
    assert baseline["off"], "expected at least one OFF candidate for 'gurke'"
    rejected_id = baseline["off"][0]["off_id"]

    monkeypatch.setattr(
        "backend.app.services.rejected_matches.get_rejected_ids",
        lambda q: {"off": {rejected_id}, "bls": set()},
    )
    result = match.search_candidates("gurke")
    assert rejected_id not in [c["off_id"] for c in result["off"]]


def test_search_candidates_passes_store_through_to_off_search(monkeypatch):
    seen = {}

    def fake_search_products_with_status(query, page_size=5, store=None):
        seen["store"] = store
        return [], False

    monkeypatch.setattr(
        "backend.app.services.off_api.search_products_with_status",
        fake_search_products_with_status,
    )
    match.search_candidates("gurke", store="Rewe")
    assert seen["store"] == "Rewe"


def test_search_candidates_surfaces_off_rate_limited_flag(monkeypatch):
    monkeypatch.setattr(
        "backend.app.services.off_api.search_products_with_status",
        lambda query, page_size=5, store=None: ([], True),
    )
    result = match.search_candidates("gurke")
    assert result["off_rate_limited"] is True
    assert result["off"] == []


def test_reject_candidate_records_it_under_the_given_source(monkeypatch):
    recorded = {}

    def fake_record(raw_text, source, external_id):
        recorded["raw_text"] = raw_text
        recorded["source"] = source
        recorded["external_id"] = external_id

    monkeypatch.setattr(
        "backend.app.services.rejected_matches.record_rejected_match", fake_record
    )
    match.reject_candidate("Dr. Oekt. Piz. Moz", "bls", "B123456")
    assert recorded == {
        "raw_text": "Dr. Oekt. Piz. Moz",
        "source": "bls",
        "external_id": "B123456",
    }

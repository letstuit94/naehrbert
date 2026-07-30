"""
Tests for services/rejected_matches.py -- the negative counterpart to
verified_matches.py (the Fix-match search panel's X button).
repo.insert_rejected_match/get_rejected_matches are monkeypatched with an
in-memory dict so these never touch the real Supabase project.
"""

from backend.app.services.rejected_matches import get_rejected_ids, record_rejected_match


def _patch_table(monkeypatch):
    rows: list = []

    def fake_insert(match_key, source, external_id):
        row = {"match_key": match_key, "source": source, "external_id": external_id}
        if row not in rows:
            rows.append(row)

    def fake_get(match_key):
        return [r for r in rows if r["match_key"] == match_key]

    monkeypatch.setattr("backend.app.db.repo.insert_rejected_match", fake_insert)
    monkeypatch.setattr("backend.app.db.repo.get_rejected_matches", fake_get)
    return rows


def test_rejected_ids_are_empty_before_anything_is_rejected(monkeypatch):
    _patch_table(monkeypatch)
    ids = get_rejected_ids("Dr. Oekt. Piz. Moz")
    assert ids == {"off": set(), "bls": set()}


def test_record_then_lookup_returns_the_rejected_id_under_its_source(monkeypatch):
    _patch_table(monkeypatch)
    record_rejected_match("Dr. Oekt. Piz. Moz", "bls", "B123456")
    ids = get_rejected_ids("Dr. Oekt. Piz. Moz")
    assert ids["bls"] == {"B123456"}
    assert ids["off"] == set()


def test_rejection_is_scoped_to_the_normalized_text_not_the_raw_text(monkeypatch):
    _patch_table(monkeypatch)
    record_rejected_match("2x Dr. Oekt. Piz. Moz 1,29€", "off", "off-1")
    # A differently-formatted receipt line for the same product (extra
    # quantity/price noise normalize_match_key already strips) still hits.
    ids = get_rejected_ids("Dr. Oekt. Piz. Moz")
    assert ids["off"] == {"off-1"}


def test_rejecting_the_same_candidate_twice_does_not_duplicate(monkeypatch):
    rows = _patch_table(monkeypatch)
    record_rejected_match("Dr. Oekt. Piz. Moz", "bls", "B123456")
    record_rejected_match("Dr. Oekt. Piz. Moz", "bls", "B123456")
    assert len(rows) == 1


def test_record_rejected_match_is_a_noop_for_blank_text(monkeypatch):
    rows = _patch_table(monkeypatch)
    record_rejected_match("   ", "bls", "B123456")
    assert rows == []


def test_get_rejected_ids_degrades_gracefully_on_lookup_failure(monkeypatch):
    def fake_get(match_key):
        raise RuntimeError("db unavailable")

    monkeypatch.setattr("backend.app.db.repo.get_rejected_matches", fake_get)
    assert get_rejected_ids("anything") == {"off": set(), "bls": set()}

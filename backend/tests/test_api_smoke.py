"""
FastAPI wiring smoke tests. The `repo` (DB) layer is monkeypatched out so
these never touch the real Supabase project — they're here to catch
routing/serialization bugs in main.py/api/*.py, not to exercise Supabase
itself (that's the end-to-end check against the real project).

Needs SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY importable (from .env locally,
or the CI workflow's placeholder env vars) since main.py builds its CORS
settings at import time — no live calls are made either way because repo
is patched below.
"""

from fastapi.testclient import TestClient

from backend.app.api import analysis as analysis_api
from backend.app.api import profile as profile_api
from backend.app.main import app

client = TestClient(app)

_PROFILE_ROW = {
    "id": 1,
    "sex": "female",
    "date_of_birth": "1994-03-15",
    "height_cm": 168,
    "weight_kg": 64,
    "exercise_frequency": "three_four",
    "daily_movement": "mixed",
    "goal": "maintain",
    "created_at": "2026-01-01T00:00:00+00:00",
    "updated_at": "2026-01-01T00:00:00+00:00",
}


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_create_profile_returns_profile_and_targets(monkeypatch):
    monkeypatch.setattr(profile_api.repo, "upsert_profile", lambda payload: _PROFILE_ROW)

    resp = client.post(
        "/profile",
        json={
            "sex": "female",
            "date_of_birth": "1994-03-15",
            "height_cm": 168,
            "weight_kg": 64,
            "exercise_frequency": "three_four",
            "daily_movement": "mixed",
            "goal": "maintain",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["profile"]["sex"] == "female"
    assert body["targets"]["calories_kcal"] > 0
    assert abs(sum(body["targets_pct"].values()) - 100) < 1.0


def test_read_profile_404_when_none_exists(monkeypatch):
    monkeypatch.setattr(profile_api.repo, "get_profile", lambda: None)
    resp = client.get("/profile")
    assert resp.status_code == 404


def test_summary_counts_distinct_receipts_and_items(monkeypatch):
    monkeypatch.setattr(
        analysis_api.repo,
        "get_all_confirmed_receipt_items",
        lambda: [
            {"receipt_id": "r1"},
            {"receipt_id": "r1"},
            {"receipt_id": "r2"},
        ],
    )
    resp = client.get("/analysis/summary")
    assert resp.status_code == 200
    assert resp.json() == {"receipts_count": 2, "items_count": 3}


def test_summary_empty_state_without_receipts(monkeypatch):
    monkeypatch.setattr(analysis_api.repo, "get_all_confirmed_receipt_items", lambda: [])
    resp = client.get("/analysis/summary")
    assert resp.status_code == 200
    assert resp.json() == {"receipts_count": 0, "items_count": 0}


def test_composition_empty_state_without_receipts(monkeypatch):
    monkeypatch.setattr(analysis_api.repo, "get_all_confirmed_receipt_items", lambda: [])
    resp = client.get("/analysis/composition")
    assert resp.status_code == 200
    assert resp.json()["items_considered"] == 0


def test_diversity_empty_state_without_receipts(monkeypatch):
    monkeypatch.setattr(analysis_api.repo, "get_all_confirmed_receipt_items", lambda: [])
    resp = client.get("/analysis/diversity")
    assert resp.status_code == 200
    assert resp.json()["recommendations"] == []

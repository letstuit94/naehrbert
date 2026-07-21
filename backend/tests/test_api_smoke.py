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
from backend.app.api import feedback as feedback_api
from backend.app.api import profile as profile_api
from backend.app.api import receipts as receipts_api
from backend.app.api import recipes as recipes_api
from backend.app.main import app
from backend.app.models.nutrition import MatchedProduct, MatchType
from backend.app.models.recipe import GeminiRecipeSuggestion, RecipeIngredient
from backend.app.services.gemini_client import GeminiNotConfigured

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


def test_purchases_converts_per_100g_to_actual_quantity_and_includes_non_food(monkeypatch):
    monkeypatch.setattr(
        analysis_api.repo,
        "get_all_confirmed_receipt_items_with_receipt_info",
        lambda: [
            {
                "id": "i1",
                "receipt_id": "r1",
                "name": "Vollmilch",
                "quantity": 500,
                "unit": "ml",
                "category": "full_fat_dairy",
                "is_non_food": False,
                "match_type": "bls",
                "matched_name": "Vollmilch 3,5%",
                "fallback_category": None,
                "confidence": 0.9,
                "calories_kcal": 64,
                "protein_g": 3.3,
                "fat_g": 3.6,
                "carbs_g": 4.8,
                "fiber_g": 0,
                "receipts": {
                    "store": "Rewe",
                    "purchased_at": "2026-07-01",
                    "created_at": "2026-07-01T10:00:00+00:00",
                },
            },
            {
                "id": "i2",
                "receipt_id": "r1",
                "name": "Pfand",
                "quantity": 1,
                "unit": "piece",
                "category": "other",
                "is_non_food": True,
                "match_type": "none",
                "matched_name": None,
                "fallback_category": None,
                "confidence": None,
                "calories_kcal": None,
                "protein_g": None,
                "fat_g": None,
                "carbs_g": None,
                "fiber_g": None,
                "receipts": {
                    "store": "Rewe",
                    "purchased_at": "2026-07-01",
                    "created_at": "2026-07-01T10:00:00+00:00",
                },
            },
        ],
    )
    resp = client.get("/analysis/purchases")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 2  # non-food item is included, unlike composition/buckets/diversity

    milk = next(i for i in items if i["name"] == "Vollmilch")
    assert milk["store"] == "Rewe"
    assert milk["calories_kcal"] == 320  # 64 kcal/100g * 500ml (=500g) / 100
    assert milk["protein_g"] == 16.5

    pfand = next(i for i in items if i["name"] == "Pfand")
    assert pfand["is_non_food"] is True
    assert pfand["calories_kcal"] is None


def _fake_resolve_capturing_store(captured):
    def fake_resolve(item):
        captured["store"] = item.get("store")
        return MatchedProduct(
            parsed_item_name=item.get("name", ""),
            match_type=MatchType.NONE,
            confidence=0.0,
            data_source="test",
        )

    return fake_resolve


def test_upload_text_injects_receipt_store_into_resolve_item(monkeypatch):
    """Regression: receipt_items has no `store` column (it lives on the
    parent receipt), so resolve_item's Tier-0 lookup was always seeing
    item.get("store") == None here -- every verified-match lookup silently
    degraded to the store-agnostic scope only, missing every row recorded
    under a real store. `store` must be merged onto the item dict passed
    to resolve_item at upload time."""

    monkeypatch.setattr(
        receipts_api.receipt_text_parser,
        "parse_receipt_text_offline",
        lambda text: {
            "store": "Rewe",
            "date": None,
            "scan_quality": "good",
            "items": [
                {
                    "name": "Chili Mix Tri",
                    "original_text": "Chili Mix Tri 1,49 B",
                    "quantity": 1.0,
                    "unit": "piece",
                    "price": 1.49,
                    "category": "other",
                    "uncertain": False,
                }
            ],
            "non_food_items_ignored": [],
            "items_count": 1,
        },
    )
    monkeypatch.setattr(receipts_api.non_food_terms, "filter_learned_non_food", lambda parsed: parsed)
    monkeypatch.setattr(receipts_api.repo, "create_receipt", lambda **kwargs: {"id": "r1", "store": "Rewe"})
    monkeypatch.setattr(
        receipts_api.repo,
        "insert_receipt_items",
        lambda receipt_id, items: [{**item, "id": "item-1", "receipt_id": receipt_id} for item in items],
    )
    monkeypatch.setattr(receipts_api.repo, "update_receipt_item", lambda item_id, fields: fields)

    captured = {}
    monkeypatch.setattr(receipts_api, "resolve_item", _fake_resolve_capturing_store(captured))

    resp = client.post("/receipts/text", json={"text": "irrelevant, parser is mocked"})
    assert resp.status_code == 200
    assert captured["store"] == "Rewe"


def test_confirm_injects_receipt_store_into_resolve_item(monkeypatch):
    """Same regression as the upload-time test, for confirm_receipt's
    resolve_item call."""

    monkeypatch.setattr(receipts_api.repo, "get_receipt", lambda rid: {"id": rid, "store": "Lidl"})
    monkeypatch.setattr(
        receipts_api.repo,
        "get_receipt_items",
        lambda rid: [{"id": "item-1", "name": "Chili Mix Tri", "is_non_food": False}],
    )
    monkeypatch.setattr(receipts_api.repo, "update_receipt_item", lambda item_id, fields: fields)
    monkeypatch.setattr(receipts_api.repo, "set_receipt_status", lambda rid, status: None)

    captured = {}
    monkeypatch.setattr(receipts_api, "resolve_item", _fake_resolve_capturing_store(captured))

    resp = client.post("/receipts/r1/confirm")
    assert resp.status_code == 200
    assert captured["store"] == "Lidl"


def test_correct_item_records_verified_match_keyed_on_cleaned_name(monkeypatch):
    """Regression: correct_item used to key the verified match on
    `original_text` (the raw, uncleaned receipt line -- e.g. still carrying
    a German tax-class letter like "Bio Paprika Mix 400g 2,29 B"), while
    the resolver's Tier-0 read path only ever looks up by the already-
    cleaned `name`. normalize_match_key doesn't strip that trailing letter
    the same way _clean_name does, so the two sides silently diverged and
    a correction was never found again. Both sides must key on `name`."""

    fake_item = {
        "id": "item-1",
        "name": "Bio Paprika Mix",
        "original_text": "Bio Paprika Mix 400g 2,29 B",
    }
    monkeypatch.setattr(receipts_api.repo, "get_receipt", lambda rid: {"store": "Netto"})
    monkeypatch.setattr(receipts_api.repo, "get_receipt_items", lambda rid: [fake_item])
    monkeypatch.setattr(receipts_api.repo, "update_receipt_item", lambda item_id, fields: fields)

    recorded = {}

    def fake_record(raw_text, store, off_id=None, bls_code=None, matched_name=None, nutrition=None):
        recorded["raw_text"] = raw_text

    monkeypatch.setattr(receipts_api.verified_matches, "record_verified_match", fake_record)

    resp = client.post(
        "/receipts/r1/items/item-1/correct",
        json={"matched_name": "Gemüsepaprika rot, roh", "bls_code": "S000100", "nutrition": {}},
    )
    assert resp.status_code == 200
    assert recorded["raw_text"] == "Bio Paprika Mix"  # the cleaned `name`, not `original_text`


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


# ── Recipe recommendations feature ────────────────────────────────────────

_RECIPE_PROFILE_ROW = {
    **_PROFILE_ROW,
    "dietary_style": "vegetarian",
    "allergies": ["peanuts"],
    "dislikes": [],
    "recipe_prefs_completed_at": "2026-07-20T00:00:00+00:00",
}


def test_unlock_status_counts_matched_items(monkeypatch):
    monkeypatch.setattr(
        recipes_api.repo,
        "get_all_confirmed_receipt_items",
        lambda: [
            {"is_non_food": False, "matched_name": "Vollmilch", "fallback_category": None},
            {"is_non_food": False, "matched_name": None, "fallback_category": "lean_poultry"},
            {"is_non_food": False, "matched_name": None, "fallback_category": None},  # no-match, excluded
            {"is_non_food": True, "matched_name": "Pfand", "fallback_category": None},  # non-food, excluded
        ],
    )
    monkeypatch.setattr(recipes_api.repo, "get_profile", lambda: None)
    resp = client.get("/recipes/unlock-status")
    assert resp.status_code == 200
    assert resp.json() == {
        "matched_items_count": 2,
        "threshold": 50,
        "unlocked": False,
        "prefs_completed": False,
    }


def test_inferred_dietary_style_endpoint(monkeypatch):
    monkeypatch.setattr(
        recipes_api.repo,
        "get_all_confirmed_receipt_items",
        lambda: [{"category": "fatty_fish", "is_non_food": False}],
    )
    resp = client.get("/recipes/inferred-dietary-style")
    assert resp.status_code == 200
    assert resp.json() == {"dietary_style": "pescatarian"}


def test_update_dietary_preferences(monkeypatch):
    monkeypatch.setattr(profile_api.repo, "get_profile", lambda: _PROFILE_ROW)
    monkeypatch.setattr(
        profile_api.repo, "update_dietary_preferences", lambda fields: {**_PROFILE_ROW, **fields}
    )

    resp = client.patch(
        "/profile/preferences",
        json={"dietary_style": "vegan", "allergies": ["gluten"], "dislikes": ["cilantro"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["dietary_style"] == "vegan"
    assert body["allergies"] == ["gluten"]
    assert body["recipe_prefs_completed_at"] is not None


def test_generate_recipe_endpoint(monkeypatch):
    monkeypatch.setattr(recipes_api.repo, "get_profile", lambda: _RECIPE_PROFILE_ROW)
    monkeypatch.setattr(analysis_api.repo, "get_all_confirmed_receipt_items", lambda: [])

    fake_suggestion = GeminiRecipeSuggestion(
        title="Lentil bowl",
        ingredients=[RecipeIngredient(name="lentils", quantity="200 g")],
        steps=["Simmer lentils."],
        prep_minutes=5,
        cook_minutes=20,
        calories_kcal=450,
        protein_g=25,
        fat_g=10,
        carbs_g=60,
        fiber_g=12,
    )
    captured_kwargs = {}

    def fake_generate(profile, gap, recs, cuisine=None, max_time_minutes=None):
        captured_kwargs["cuisine"] = cuisine
        captured_kwargs["max_time_minutes"] = max_time_minutes
        return fake_suggestion

    monkeypatch.setattr(recipes_api, "generate_and_assemble_recipe", fake_generate)
    monkeypatch.setattr(
        recipes_api.repo,
        "insert_recipe",
        lambda row: {**row, "id": "recipe-1", "created_at": "2026-07-21T00:00:00+00:00"},
    )

    resp = client.post("/recipes/generate", json={"cuisine": "Thai", "max_time_minutes": 30})
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Lentil bowl"
    assert body["ingredients"] == [{"name": "lentils", "quantity": "200 g"}]
    assert captured_kwargs == {"cuisine": "Thai", "max_time_minutes": 30}


def test_generate_recipe_without_body_uses_no_cuisine_or_time_limit(monkeypatch):
    """POST /recipes/generate with an empty body (the common case) must
    still work -- cuisine/max_time_minutes are optional per-generation
    inputs, not required ones."""

    monkeypatch.setattr(recipes_api.repo, "get_profile", lambda: _RECIPE_PROFILE_ROW)
    monkeypatch.setattr(analysis_api.repo, "get_all_confirmed_receipt_items", lambda: [])

    fake_suggestion = GeminiRecipeSuggestion(
        title="Simple bowl",
        ingredients=[RecipeIngredient(name="rice", quantity="200 g")],
        steps=["Cook rice."],
        prep_minutes=5,
        cook_minutes=15,
        calories_kcal=300,
        protein_g=6,
        fat_g=1,
        carbs_g=65,
        fiber_g=2,
    )
    captured_kwargs = {}

    def fake_generate(profile, gap, recs, cuisine=None, max_time_minutes=None):
        captured_kwargs["cuisine"] = cuisine
        captured_kwargs["max_time_minutes"] = max_time_minutes
        return fake_suggestion

    monkeypatch.setattr(recipes_api, "generate_and_assemble_recipe", fake_generate)
    monkeypatch.setattr(
        recipes_api.repo,
        "insert_recipe",
        lambda row: {**row, "id": "recipe-2", "created_at": "2026-07-21T00:00:00+00:00"},
    )

    resp = client.post("/recipes/generate")
    assert resp.status_code == 200
    assert captured_kwargs == {"cuisine": None, "max_time_minutes": None}


def test_generate_recipe_404_without_profile(monkeypatch):
    monkeypatch.setattr(recipes_api.repo, "get_profile", lambda: None)
    resp = client.post("/recipes/generate")
    assert resp.status_code == 404


def test_generate_recipe_returns_503_when_gemini_not_configured(monkeypatch):
    monkeypatch.setattr(recipes_api.repo, "get_profile", lambda: _RECIPE_PROFILE_ROW)
    monkeypatch.setattr(analysis_api.repo, "get_all_confirmed_receipt_items", lambda: [])

    def raise_not_configured(profile, gap, recs, cuisine=None, max_time_minutes=None):
        raise GeminiNotConfigured("GEMINI_API_KEY is not set")

    monkeypatch.setattr(recipes_api, "generate_and_assemble_recipe", raise_not_configured)
    resp = client.post("/recipes/generate")
    assert resp.status_code == 503


def test_list_recipes_endpoint(monkeypatch):
    monkeypatch.setattr(
        recipes_api.repo,
        "get_all_recipes",
        lambda: [
            {
                "id": "r1",
                "title": "Lentil bowl",
                "ingredients": [{"name": "lentils", "quantity": "200 g"}],
                "steps": ["Simmer."],
                "prep_minutes": 5,
                "cook_minutes": 20,
                "calories_kcal": 450,
                "protein_g": 25,
                "fat_g": 10,
                "carbs_g": 60,
                "fiber_g": 12,
                "created_at": "2026-07-21T00:00:00+00:00",
            }
        ],
    )
    resp = client.get("/recipes")
    assert resp.status_code == 200
    assert resp.json()[0]["title"] == "Lentil bowl"


def test_submit_feedback(monkeypatch):
    monkeypatch.setattr(
        feedback_api.repo,
        "insert_feedback",
        lambda score: {
            "id": "f1",
            "profile_id": 1,
            "nps_score": score,
            "created_at": "2026-07-21T00:00:00+00:00",
        },
    )
    resp = client.post("/feedback", json={"nps_score": 9})
    assert resp.status_code == 200
    assert resp.json()["nps_score"] == 9

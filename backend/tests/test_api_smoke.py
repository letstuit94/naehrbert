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
from backend.app.api import pantry as pantry_api
from backend.app.api import profile as profile_api
from backend.app.api import profiles as profiles_api
from backend.app.api import receipts as receipts_api
from backend.app.api import recipes as recipes_api
from backend.app.main import app
from backend.app.models.nutrition import MatchedProduct, MatchType
from backend.app.models.recipe import GeminiRecipeSuggestion, RecipeIngredient
from backend.app.services.gemini_client import GeminiNotConfigured

client = TestClient(app)

# Every protected endpoint reads the logged-in profile off this header
# (multi-user feature, backend/app/core/auth.py) -- tests act as profile 1
# throughout, matching _PROFILE_ROW below.
AUTH = {"X-Profile-Id": "1"}

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
    monkeypatch.setattr(
        profile_api.repo, "upsert_profile", lambda payload, profile_id: _PROFILE_ROW
    )

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
        headers=AUTH,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["profile"]["sex"] == "female"
    assert body["targets"]["calories_kcal"] > 0
    assert abs(sum(body["targets_pct"].values()) - 100) < 1.0


def test_create_profile_signup_has_no_profile_id_yet(monkeypatch):
    """No X-Profile-Id header -- the onboarding-chat signup path, a brand
    new user with nothing to log in as yet -- must insert rather than
    update, so `profile_id` reaches the repo as None (repo.upsert_profile
    branches insert-vs-update on exactly this)."""

    captured = {}

    def fake_upsert(payload, profile_id):
        captured["profile_id"] = profile_id
        return _PROFILE_ROW

    monkeypatch.setattr(profile_api.repo, "upsert_profile", fake_upsert)
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
    assert captured["profile_id"] is None


def test_read_profile_404_when_none_exists(monkeypatch):
    monkeypatch.setattr(profile_api.repo, "get_profile", lambda profile_id: None)
    resp = client.get("/profile", headers=AUTH)
    assert resp.status_code == 404


def test_read_profile_401_without_login(monkeypatch):
    resp = client.get("/profile")
    assert resp.status_code == 401


def test_list_profiles_endpoint(monkeypatch):
    monkeypatch.setattr(
        profiles_api.repo,
        "list_profiles",
        lambda: [{"id": 1, "name": "Stu"}, {"id": 2, "name": None}],
    )
    resp = client.get("/profiles")
    assert resp.status_code == 200
    assert resp.json() == [{"id": 1, "name": "Stu"}, {"id": 2, "name": None}]


def test_purchases_converts_per_100g_to_actual_quantity_and_includes_non_food(monkeypatch):
    monkeypatch.setattr(
        analysis_api.repo,
        "get_all_confirmed_receipt_items_with_receipt_info",
        lambda profile_id: [
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
    resp = client.get("/analysis/purchases", headers=AUTH)
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


def test_confirm_receipt_404_when_owned_by_a_different_profile(monkeypatch):
    """A receipt that exists but belongs to profile 2 must look identical
    to a missing one from profile 1's point of view -- no leaking whether
    the id exists at all."""

    monkeypatch.setattr(
        receipts_api.repo, "get_receipt", lambda rid: {"id": rid, "store": "Lidl", "profile_id": 2}
    )
    resp = client.post("/receipts/r1/confirm", headers=AUTH)
    assert resp.status_code == 404


def test_resolve_concurrently_preserves_order_despite_out_of_order_completion(monkeypatch):
    """Regression guard for the concurrency change: items are resolved in
    a thread pool now (real motivation: a 25-item receipt with almost no
    prior verified matches took ~58s resolving OFF lookups sequentially),
    so a slower-finishing item must not shift later items out of position
    in the result list -- confirm_receipt/zip() depend on index alignment
    between `food_items` and the resolved MatchedProduct list."""

    import time

    def fake_resolve(item):
        # "A" deliberately finishes last despite starting first, so a
        # naive as-completed order would misplace it.
        time.sleep(0.05 if item["name"] == "A" else 0.01)
        return MatchedProduct(
            parsed_item_name=item["name"], match_type=MatchType.NONE, confidence=0.0, data_source="test"
        )

    monkeypatch.setattr(receipts_api, "resolve_item", fake_resolve)
    items = [{"name": "A"}, {"name": "B"}, {"name": "C"}]
    results = receipts_api._resolve_concurrently(items)
    assert [r.parsed_item_name for r in results] == ["A", "B", "C"]


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
    monkeypatch.setattr(
        receipts_api.repo, "get_receipt", lambda rid: {"store": "Netto", "profile_id": 1}
    )
    monkeypatch.setattr(receipts_api.repo, "get_receipt_items", lambda rid: [fake_item])
    monkeypatch.setattr(receipts_api.repo, "update_receipt_item", lambda item_id, fields: fields)

    recorded = {}

    def fake_record(raw_text, store, off_id=None, bls_code=None, matched_name=None, nutrition=None):
        recorded["raw_text"] = raw_text

    monkeypatch.setattr(receipts_api.verified_matches, "record_verified_match", fake_record)

    resp = client.post(
        "/receipts/r1/items/item-1/correct",
        json={"matched_name": "Gemüsepaprika rot, roh", "bls_code": "S000100", "nutrition": {}},
        headers=AUTH,
    )
    assert resp.status_code == 200
    assert recorded["raw_text"] == "Bio Paprika Mix"  # the cleaned `name`, not `original_text`


def test_update_item_marking_non_food_learns_the_term(monkeypatch):
    """Regression: non_food_terms.py's read-side filter (filter_learned_non_food,
    already wired into _persist_parsed) had no write side calling it --
    marking an item "Not food" in review never actually taught the system,
    so the same product kept needing the checkbox on every future receipt."""

    monkeypatch.setattr(
        receipts_api.repo, "get_receipt", lambda rid: {"id": rid, "store": "Netto", "profile_id": 1}
    )
    monkeypatch.setattr(
        receipts_api.repo,
        "update_receipt_item",
        lambda item_id, fields: {
            "id": item_id, "name": "Batterien AA", "original_text": "Batterien AA 4er", **fields
        },
    )
    recorded = {}
    monkeypatch.setattr(
        receipts_api.non_food_terms,
        "record_non_food_term",
        lambda name: recorded.update(name=name),
    )

    resp = client.patch(
        "/receipts/r1/items/item-1", json={"is_non_food": True}, headers=AUTH
    )
    assert resp.status_code == 200
    assert recorded["name"] == "Batterien AA"  # the cleaned `name`, not `original_text`


def test_update_item_editing_other_fields_does_not_learn_non_food(monkeypatch):
    monkeypatch.setattr(
        receipts_api.repo, "get_receipt", lambda rid: {"id": rid, "store": "Netto", "profile_id": 1}
    )
    monkeypatch.setattr(
        receipts_api.repo,
        "update_receipt_item",
        lambda item_id, fields: {"id": item_id, "name": "Apfel", **fields},
    )
    called = {"recorded": False}
    monkeypatch.setattr(
        receipts_api.non_food_terms,
        "record_non_food_term",
        lambda name: called.__setitem__("recorded", True),
    )

    resp = client.patch("/receipts/r1/items/item-1", json={"quantity": 3}, headers=AUTH)
    assert resp.status_code == 200
    assert called["recorded"] is False


def test_update_item_unmarking_non_food_does_not_learn(monkeypatch):
    """Setting is_non_food back to False is just a correction -- it must not
    also (re-)teach the term as if it had been marked non-food."""

    monkeypatch.setattr(
        receipts_api.repo, "get_receipt", lambda rid: {"id": rid, "store": "Netto", "profile_id": 1}
    )
    monkeypatch.setattr(
        receipts_api.repo,
        "update_receipt_item",
        lambda item_id, fields: {"id": item_id, "name": "Apfel", **fields},
    )
    called = {"recorded": False}
    monkeypatch.setattr(
        receipts_api.non_food_terms,
        "record_non_food_term",
        lambda name: called.__setitem__("recorded", True),
    )

    resp = client.patch("/receipts/r1/items/item-1", json={"is_non_food": False}, headers=AUTH)
    assert resp.status_code == 200
    assert called["recorded"] is False


def test_summary_counts_distinct_receipts_and_items(monkeypatch):
    monkeypatch.setattr(
        analysis_api.repo,
        "get_all_confirmed_receipt_items",
        lambda profile_id: [
            {"receipt_id": "r1"},
            {"receipt_id": "r1"},
            {"receipt_id": "r2"},
        ],
    )
    resp = client.get("/analysis/summary", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json() == {"receipts_count": 2, "items_count": 3}


def test_summary_401_without_login(monkeypatch):
    resp = client.get("/analysis/summary")
    assert resp.status_code == 401


def test_summary_empty_state_without_receipts(monkeypatch):
    monkeypatch.setattr(analysis_api.repo, "get_all_confirmed_receipt_items", lambda profile_id: [])
    resp = client.get("/analysis/summary", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json() == {"receipts_count": 0, "items_count": 0}


def test_composition_empty_state_without_receipts(monkeypatch):
    monkeypatch.setattr(analysis_api.repo, "get_all_confirmed_receipt_items", lambda profile_id: [])
    resp = client.get("/analysis/composition", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["items_considered"] == 0


def test_target_comparison_closeness_score_sums_not_averages_macro_diffs(monkeypatch):
    """Regression: closeness_score used to average the 3 macro diffs, which
    let one macro be badly off target (e.g. protein at half its goal) hide
    behind two that were close, producing a deceptively high score for a
    purchase pattern that's actually missing a target by a lot. It now sums
    the absolute per-macro differences instead."""

    monkeypatch.setattr(analysis_api.repo, "get_profile", lambda profile_id: _PROFILE_ROW)
    monkeypatch.setattr(
        analysis_api.repo,
        "get_all_confirmed_receipt_items",
        lambda profile_id: [
            {
                "receipt_id": "r1",
                "quantity": 100,
                "unit": "g",
                "protein_g": 3.0,
                "fat_g": 12.0,
                "carbs_g": 25.0,
                "calories_kcal": 200,
                "match_type": "exact",
            },
        ],
    )
    resp = client.get("/analysis/target-comparison", headers=AUTH)
    assert resp.status_code == 200
    body = resp.json()

    diffs = [
        abs(body["actual_pct"][m] - body["target_pct"][f"{m}_pct"])
        for m in ("protein", "fat", "carb")
    ]
    assert body["closeness_score"] == round(max(0.0, 100.0 - sum(diffs)), 1)

    # Sanity: with these 3 (deliberately mismatched) macros, summing must
    # differ from averaging -- otherwise this test couldn't tell the two
    # formulas apart.
    averaged = round(max(0.0, 100.0 - sum(diffs) / len(diffs)), 1)
    assert body["closeness_score"] != averaged


def test_diversity_empty_state_without_receipts(monkeypatch):
    monkeypatch.setattr(analysis_api.repo, "get_all_confirmed_receipt_items", lambda profile_id: [])
    resp = client.get("/analysis/diversity", headers=AUTH)
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
        lambda profile_id: [
            {"is_non_food": False, "matched_name": "Vollmilch", "fallback_category": None},
            {"is_non_food": False, "matched_name": None, "fallback_category": "lean_poultry"},
            {"is_non_food": False, "matched_name": None, "fallback_category": None},  # no-match, excluded
            {"is_non_food": True, "matched_name": "Pfand", "fallback_category": None},  # non-food, excluded
        ],
    )
    monkeypatch.setattr(recipes_api.repo, "get_profile", lambda profile_id: None)
    resp = client.get("/recipes/unlock-status", headers=AUTH)
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
        lambda profile_id: [{"category": "fatty_fish", "is_non_food": False}],
    )
    resp = client.get("/recipes/inferred-dietary-style", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json() == {"dietary_style": "pescatarian"}


def test_update_dietary_preferences(monkeypatch):
    monkeypatch.setattr(profile_api.repo, "get_profile", lambda profile_id: _PROFILE_ROW)
    monkeypatch.setattr(
        profile_api.repo,
        "update_dietary_preferences",
        lambda profile_id, fields: {**_PROFILE_ROW, **fields},
    )

    resp = client.patch(
        "/profile/preferences",
        json={"dietary_style": "vegan", "allergies": ["gluten"], "dislikes": ["cilantro"]},
        headers=AUTH,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["dietary_style"] == "vegan"
    assert body["allergies"] == ["gluten"]
    assert body["recipe_prefs_completed_at"] is not None


def test_generate_recipe_endpoint(monkeypatch):
    monkeypatch.setattr(recipes_api.repo, "get_profile", lambda profile_id: _RECIPE_PROFILE_ROW)
    monkeypatch.setattr(
        analysis_api.repo, "get_all_confirmed_receipt_items", lambda profile_id: []
    )

    fake_suggestion = GeminiRecipeSuggestion(
        title="Lentil bowl",
        ingredients=[RecipeIngredient(name="lentils", quantity="200 g")],
        steps=["Simmer lentils."],
        prep_minutes=5,
        cook_minutes=20,
        servings=2,
        calories_kcal=450,
        protein_g=25,
        fat_g=10,
        carbs_g=60,
        fiber_g=12,
        dietary_label="vegan",
    )
    captured_kwargs = {}

    def fake_generate(profile, gap, recs, cuisine=None, max_time_minutes=None, servings=None):
        captured_kwargs["cuisine"] = cuisine
        captured_kwargs["max_time_minutes"] = max_time_minutes
        captured_kwargs["servings"] = servings
        return fake_suggestion

    monkeypatch.setattr(recipes_api, "generate_and_assemble_recipe", fake_generate)
    monkeypatch.setattr(
        recipes_api.repo,
        "insert_recipe",
        lambda profile_id, row: {**row, "id": "recipe-1", "created_at": "2026-07-21T00:00:00+00:00"},
    )

    resp = client.post(
        "/recipes/generate",
        json={"cuisine": "Thai", "max_time_minutes": 30, "servings": 4},
        headers=AUTH,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Lentil bowl"
    assert body["ingredients"] == [{"name": "lentils", "quantity": "200 g"}]
    assert captured_kwargs == {"cuisine": "Thai", "max_time_minutes": 30, "servings": 4}


def test_generate_recipe_without_body_uses_no_cuisine_or_time_limit(monkeypatch):
    """POST /recipes/generate with an empty body (the common case) must
    still work -- cuisine/max_time_minutes/servings are optional
    per-generation inputs, not required ones."""

    monkeypatch.setattr(recipes_api.repo, "get_profile", lambda profile_id: _RECIPE_PROFILE_ROW)
    monkeypatch.setattr(
        analysis_api.repo, "get_all_confirmed_receipt_items", lambda profile_id: []
    )

    fake_suggestion = GeminiRecipeSuggestion(
        title="Simple bowl",
        ingredients=[RecipeIngredient(name="rice", quantity="200 g")],
        steps=["Cook rice."],
        prep_minutes=5,
        cook_minutes=15,
        servings=2,
        calories_kcal=300,
        protein_g=6,
        fat_g=1,
        carbs_g=65,
        fiber_g=2,
        dietary_label="vegan",
    )
    captured_kwargs = {}

    def fake_generate(profile, gap, recs, cuisine=None, max_time_minutes=None, servings=None):
        captured_kwargs["cuisine"] = cuisine
        captured_kwargs["max_time_minutes"] = max_time_minutes
        captured_kwargs["servings"] = servings
        return fake_suggestion

    monkeypatch.setattr(recipes_api, "generate_and_assemble_recipe", fake_generate)
    monkeypatch.setattr(
        recipes_api.repo,
        "insert_recipe",
        lambda profile_id, row: {**row, "id": "recipe-2", "created_at": "2026-07-21T00:00:00+00:00"},
    )

    resp = client.post("/recipes/generate", headers=AUTH)
    assert resp.status_code == 200
    assert captured_kwargs == {"cuisine": None, "max_time_minutes": None, "servings": None}


def test_generate_recipe_404_without_profile(monkeypatch):
    monkeypatch.setattr(recipes_api.repo, "get_profile", lambda profile_id: None)
    resp = client.post("/recipes/generate", headers=AUTH)
    assert resp.status_code == 404


def test_generate_recipe_401_without_login(monkeypatch):
    resp = client.post("/recipes/generate")
    assert resp.status_code == 401


def test_generate_recipe_returns_503_when_gemini_not_configured(monkeypatch):
    monkeypatch.setattr(recipes_api.repo, "get_profile", lambda profile_id: _RECIPE_PROFILE_ROW)
    monkeypatch.setattr(
        analysis_api.repo, "get_all_confirmed_receipt_items", lambda profile_id: []
    )

    def raise_not_configured(profile, gap, recs, cuisine=None, max_time_minutes=None, servings=None):
        raise GeminiNotConfigured("GEMINI_API_KEY is not set")

    monkeypatch.setattr(recipes_api, "generate_and_assemble_recipe", raise_not_configured)
    resp = client.post("/recipes/generate", headers=AUTH)
    assert resp.status_code == 503


def test_list_recipes_endpoint(monkeypatch):
    monkeypatch.setattr(
        recipes_api.repo,
        "get_all_recipes",
        lambda profile_id: [
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
    resp = client.get("/recipes", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()[0]["title"] == "Lentil bowl"


_STORED_RECIPE_ROW = {
    "id": "r1",
    "profile_id": 1,
    "title": "Lentil bowl",
    "ingredients": [{"name": "lentils", "quantity": "200 g"}],
    "steps": ["Simmer."],
    "prep_minutes": 5,
    "cook_minutes": 20,
    "servings": 2,
    "calories_kcal": 450,
    "protein_g": 25,
    "fat_g": 10,
    "carbs_g": 60,
    "fiber_g": 12,
    "dietary_label": "vegan",
    "feedback": None,
    "archived_at": None,
    "created_at": "2026-07-21T00:00:00+00:00",
}


def test_set_recipe_feedback_endpoint(monkeypatch):
    monkeypatch.setattr(recipes_api.repo, "get_recipe", lambda rid: _STORED_RECIPE_ROW)
    captured = {}
    monkeypatch.setattr(
        recipes_api.repo,
        "update_recipe",
        lambda rid, fields: captured.update(id=rid, fields=fields)
        or {**_STORED_RECIPE_ROW, **fields},
    )
    resp = client.patch("/recipes/r1/feedback", json={"feedback": "up"}, headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["feedback"] == "up"
    assert captured == {"id": "r1", "fields": {"feedback": "up"}}


def test_set_recipe_feedback_clears_with_null(monkeypatch):
    monkeypatch.setattr(
        recipes_api.repo, "get_recipe", lambda rid: {**_STORED_RECIPE_ROW, "feedback": "up"}
    )
    monkeypatch.setattr(
        recipes_api.repo,
        "update_recipe",
        lambda rid, fields: {**_STORED_RECIPE_ROW, **fields},
    )
    resp = client.patch("/recipes/r1/feedback", json={"feedback": None}, headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["feedback"] is None


def test_set_recipe_feedback_404_for_another_profiles_recipe(monkeypatch):
    monkeypatch.setattr(
        recipes_api.repo, "get_recipe", lambda rid: {**_STORED_RECIPE_ROW, "profile_id": 2}
    )
    resp = client.patch("/recipes/r1/feedback", json={"feedback": "down"}, headers=AUTH)
    assert resp.status_code == 404


def test_set_recipe_feedback_401_without_login(monkeypatch):
    resp = client.patch("/recipes/r1/feedback", json={"feedback": "up"})
    assert resp.status_code == 401


def test_archive_recipe_endpoint(monkeypatch):
    monkeypatch.setattr(recipes_api.repo, "get_recipe", lambda rid: _STORED_RECIPE_ROW)
    captured = {}
    monkeypatch.setattr(
        recipes_api.repo,
        "update_recipe",
        lambda rid, fields: captured.update(id=rid, fields=fields),
    )
    resp = client.delete("/recipes/r1", headers=AUTH)
    assert resp.status_code == 204
    assert captured["id"] == "r1"
    assert "archived_at" in captured["fields"]  # soft-delete, not a hard row delete


def test_archive_recipe_404_for_another_profiles_recipe(monkeypatch):
    monkeypatch.setattr(
        recipes_api.repo, "get_recipe", lambda rid: {**_STORED_RECIPE_ROW, "profile_id": 2}
    )
    resp = client.delete("/recipes/r1", headers=AUTH)
    assert resp.status_code == 404


def test_archive_recipe_401_without_login(monkeypatch):
    resp = client.delete("/recipes/r1")
    assert resp.status_code == 401


def test_list_recipes_excludes_archived(monkeypatch):
    """get_all_recipes itself does the archived_at filtering (repo.py) --
    this just confirms the endpoint returns whatever the repo hands back,
    i.e. it doesn't re-include archived rows some other way."""

    monkeypatch.setattr(recipes_api.repo, "get_all_recipes", lambda profile_id: [])
    resp = client.get("/recipes", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json() == []


# ── Pantry / basket (Vorrat.md) ───────────────────────────────────────────


def test_pantry_scales_macros_to_remaining_food_only_newest_first(monkeypatch):
    """GET /pantry returns v_pantry rows as basket lots: kcal/macros scaled to
    the amount STILL in stock (remaining_quantity, not the purchased quantity),
    is_non_food always false, newest purchase first."""

    monkeypatch.setattr(
        pantry_api.repo,
        "get_pantry",
        lambda profile_id: [
            {
                "id": "i-old",
                "receipt_id": "r1",
                "name": "Reis",
                "quantity": 1000,
                "remaining_quantity": 1000,  # untouched
                "unit": "g",
                "category": "grains",
                "match_type": "bls",
                "matched_name": "Reis, roh",
                "fallback_category": None,
                "confidence": 0.9,
                "calories_kcal": 350,
                "protein_g": 7,
                "fat_g": 1,
                "carbs_g": 78,
                "fiber_g": 1.3,
                "store": "Rewe",
                "purchased_at": "2026-06-01",
            },
            {
                "id": "i-new",
                "receipt_id": "r2",
                "name": "Vollmilch",
                "quantity": 500,
                "remaining_quantity": 250,  # half already drunk
                "unit": "ml",
                "category": "full_fat_dairy",
                "match_type": "bls",
                "matched_name": "Vollmilch 3,5%",
                "fallback_category": None,
                "confidence": 0.9,
                "calories_kcal": 64,
                "protein_g": 3.3,
                "fat_g": 3.6,
                "carbs_g": 4.8,
                "fiber_g": 0,
                "store": "Rewe",
                "purchased_at": "2026-07-01",
            },
        ],
    )
    resp = client.get("/pantry", headers=AUTH)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert [i["name"] for i in items] == ["Vollmilch", "Reis"]  # newest first
    assert all(i["is_non_food"] is False for i in items)
    milk = items[0]
    assert milk["quantity"] == 250  # remaining shown, not the 500 bought
    assert milk["original_quantity"] == 500
    assert milk["calories_kcal"] == 160  # 64 kcal/100g * 250ml (=250g) / 100, scaled to remaining
    assert milk["protein_g"] == 8.2  # 3.3 * 2.5 = 8.25, rounded to 1 decimal


def test_pantry_removal_whole_lot_applies_full_remaining(monkeypatch):
    """No quantity in the payload = withdraw the whole remaining amount; the
    server resolves that to the current remaining and reports it."""

    monkeypatch.setattr(pantry_api.repo, "get_receipt_item_owner", lambda item_id: 1)
    monkeypatch.setattr(pantry_api.repo, "get_lot_remaining", lambda item_id: 3.0)
    captured = {}

    def fake_add(receipt_item_id, reason, quantity=None):
        captured.update(receipt_item_id=receipt_item_id, reason=reason, quantity=quantity)
        return {"id": "rm1", "receipt_item_id": receipt_item_id, "reason": reason,
                "quantity": quantity, "removed_at": "2026-07-23T00:00:00+00:00"}

    monkeypatch.setattr(pantry_api.repo, "add_pantry_removal", fake_add)
    resp = client.post(
        "/pantry/removals", json={"receipt_item_id": "i1", "reason": "eaten"}, headers=AUTH
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["reason"] == "eaten"
    assert body["applied_quantity"] == 3.0
    assert body["remaining_after"] == 0.0
    assert body["clamped"] is False
    assert captured["quantity"] == 3.0  # full remaining written, not None


def test_pantry_removal_partial_leaves_remainder(monkeypatch):
    monkeypatch.setattr(pantry_api.repo, "get_receipt_item_owner", lambda item_id: 1)
    monkeypatch.setattr(pantry_api.repo, "get_lot_remaining", lambda item_id: 1.0)
    captured = {}
    monkeypatch.setattr(
        pantry_api.repo,
        "add_pantry_removal",
        lambda receipt_item_id, reason, quantity=None: captured.update(quantity=quantity)
        or {"id": "rm1", "receipt_item_id": receipt_item_id, "reason": reason,
            "quantity": quantity, "removed_at": "2026-07-23T00:00:00+00:00"},
    )
    resp = client.post(
        "/pantry/removals",
        json={"receipt_item_id": "i1", "reason": "eaten", "quantity": 0.2},
        headers=AUTH,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["applied_quantity"] == 0.2
    assert body["remaining_after"] == 0.8
    assert body["clamped"] is False
    assert captured["quantity"] == 0.2


def test_pantry_removal_clamps_overshoot(monkeypatch):
    """Requesting more than what's left is clamped to the remaining, not
    rejected -- the honest outcome for a stale UI / concurrent request."""

    monkeypatch.setattr(pantry_api.repo, "get_receipt_item_owner", lambda item_id: 1)
    monkeypatch.setattr(pantry_api.repo, "get_lot_remaining", lambda item_id: 0.3)
    captured = {}
    monkeypatch.setattr(
        pantry_api.repo,
        "add_pantry_removal",
        lambda receipt_item_id, reason, quantity=None: captured.update(quantity=quantity)
        or {"id": "rm1", "receipt_item_id": receipt_item_id, "reason": reason,
            "quantity": quantity, "removed_at": "2026-07-23T00:00:00+00:00"},
    )
    resp = client.post(
        "/pantry/removals",
        json={"receipt_item_id": "i1", "reason": "eaten", "quantity": 0.5},
        headers=AUTH,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["applied_quantity"] == 0.3  # clamped down to what was left
    assert body["remaining_after"] == 0.0
    assert body["clamped"] is True
    assert captured["quantity"] == 0.3


def test_pantry_removal_409_when_nothing_left(monkeypatch):
    monkeypatch.setattr(pantry_api.repo, "get_receipt_item_owner", lambda item_id: 1)
    monkeypatch.setattr(pantry_api.repo, "get_lot_remaining", lambda item_id: 0.0)
    called = {"added": False}
    monkeypatch.setattr(
        pantry_api.repo, "add_pantry_removal", lambda *a, **k: called.__setitem__("added", True)
    )
    resp = client.post(
        "/pantry/removals", json={"receipt_item_id": "i1", "reason": "eaten"}, headers=AUTH
    )
    assert resp.status_code == 409
    assert called["added"] is False


def test_pantry_removal_rejects_invalid_reason(monkeypatch):
    monkeypatch.setattr(pantry_api.repo, "get_receipt_item_owner", lambda item_id: 1)
    resp = client.post(
        "/pantry/removals", json={"receipt_item_id": "i1", "reason": "burned"}, headers=AUTH
    )
    assert resp.status_code == 422  # reason not in {eaten, removed}


def test_pantry_removal_404_for_another_profiles_item(monkeypatch):
    """You can't withdraw a lot you don't own -- and it must look like the
    item simply doesn't exist, never revealing it belongs to someone else."""

    monkeypatch.setattr(pantry_api.repo, "get_receipt_item_owner", lambda item_id: 2)
    called = {"added": False}
    monkeypatch.setattr(
        pantry_api.repo,
        "add_pantry_removal",
        lambda *a, **k: called.__setitem__("added", True),
    )
    resp = client.post(
        "/pantry/removals", json={"receipt_item_id": "i1", "reason": "eaten"}, headers=AUTH
    )
    assert resp.status_code == 404
    assert called["added"] is False  # never reached the write


def test_pantry_removal_404_for_unknown_item(monkeypatch):
    monkeypatch.setattr(pantry_api.repo, "get_receipt_item_owner", lambda item_id: None)
    resp = client.post(
        "/pantry/removals", json={"receipt_item_id": "nope", "reason": "removed"}, headers=AUTH
    )
    assert resp.status_code == 404


def test_delete_pantry_removal_undo_checks_ownership(monkeypatch):
    monkeypatch.setattr(
        pantry_api.repo, "get_pantry_removal", lambda rid: {"id": rid, "receipt_item_id": "i1"}
    )
    monkeypatch.setattr(pantry_api.repo, "get_receipt_item_owner", lambda item_id: 1)
    deleted = {"id": None}
    monkeypatch.setattr(
        pantry_api.repo, "remove_pantry_removal", lambda rid: deleted.__setitem__("id", rid)
    )
    resp = client.delete("/pantry/removals/rm1", headers=AUTH)
    assert resp.status_code == 204
    assert deleted["id"] == "rm1"


def test_delete_pantry_removal_404_for_another_profiles_removal(monkeypatch):
    monkeypatch.setattr(
        pantry_api.repo, "get_pantry_removal", lambda rid: {"id": rid, "receipt_item_id": "i1"}
    )
    monkeypatch.setattr(pantry_api.repo, "get_receipt_item_owner", lambda item_id: 2)
    resp = client.delete("/pantry/removals/rm1", headers=AUTH)
    assert resp.status_code == 404


def test_pantry_401_without_login(monkeypatch):
    assert client.get("/pantry").status_code == 401
    assert client.post(
        "/pantry/removals", json={"receipt_item_id": "i1", "reason": "eaten"}
    ).status_code == 401


def test_submit_feedback(monkeypatch):
    monkeypatch.setattr(
        feedback_api.repo,
        "insert_feedback",
        lambda profile_id, score: {
            "id": "f1",
            "profile_id": profile_id,
            "nps_score": score,
            "created_at": "2026-07-21T00:00:00+00:00",
        },
    )
    resp = client.post("/feedback", json={"nps_score": 9}, headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["nps_score"] == 9


def test_submit_feedback_401_without_login(monkeypatch):
    resp = client.post("/feedback", json={"nps_score": 9})
    assert resp.status_code == 401

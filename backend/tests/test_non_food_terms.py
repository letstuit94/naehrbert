from backend.app.services.non_food_terms import (
    filter_learned_non_food,
    is_non_food_category,
    known_non_food_keys,
)


def test_is_non_food_category():
    assert is_non_food_category("non_food") is True
    assert is_non_food_category("NON_FOOD") is True
    assert is_non_food_category("dairy") is False
    assert is_non_food_category(None) is False


def test_known_non_food_keys_degrades_gracefully_without_db(monkeypatch):
    """No SUPABASE_URL/KEY configured in the unit-test environment — this
    must never raise, only degrade to an empty set (the DB call is
    function-local specifically so importing/using this module doesn't
    require credentials; see the Epic 0.3 fix this module carries)."""

    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    assert known_non_food_keys() == set()


def test_filter_learned_non_food_is_a_noop_without_learned_keys(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    parsed = {"items": [{"name": "Banane", "original_text": "Banane 1,29"}], "non_food_items_ignored": []}
    assert filter_learned_non_food(parsed) == parsed

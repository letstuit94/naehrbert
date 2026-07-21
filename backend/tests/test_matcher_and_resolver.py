"""
Matcher/resolver tests deliberately use query terms already present in the
committed `_off_cache.json` ("gurke", "banane", ...) so `off_api.search_products`
is a pure cache hit and these tests never make a live network call.
"""

from backend.app.models.nutrition import MatchType
from backend.app.services.matcher import match_product
from backend.app.services.resolver import resolve_item


def test_match_product_hits_the_prebuilt_cache_offline():
    result = match_product("gurke")
    assert result is not None
    assert result.nutrition is not None
    assert result.match_type in (MatchType.EXACT, MatchType.FUZZY)


def test_match_product_returns_none_for_no_candidates(monkeypatch):
    from backend.app.services import off_api

    # No network, no on-disk cache mutation: monkeypatch the search
    # function directly to exercise matcher.py's "no candidates" branch.
    monkeypatch.setattr(off_api, "search_products", lambda query, page_size=5: [])
    assert match_product("zzz-not-a-real-product-zzz") is None


def test_resolve_item_non_food_short_circuits_without_matching():
    item = {"name": "Pfandflasche", "category": "non_food"}
    result = resolve_item(item)
    assert result.match_type == MatchType.NONE
    assert result.nutrition is None


def test_resolve_item_resolves_a_cached_grocery_item():
    item = {"name": "Banane", "category": "obst", "quantity": 1, "unit": "kg"}
    result = resolve_item(item)
    assert result.nutrition is not None
    assert result.match_type != MatchType.NONE
    assert 0.0 <= result.confidence <= 1.0

"""
OpenFoodFacts lookup (Task 2.1 / Story 2.1).

Uses the stable OpenFoodFacts REST search endpoint directly via `requests`
rather than the SDK, plus a small on-disk JSON cache so repeated lookups
(and test runs) don't hammer the API or hit rate limits.

Everything here fails soft: network errors, timeouts, or empty results
return an empty list / None instead of raising, so one bad lookup never
breaks the pipeline (Story 2.1: "missing items handled gracefully").
"""

import json
import threading
import time
from pathlib import Path
from typing import List, Optional

import requests

from backend.app.models.nutrition import NutritionValues

# OpenFoodFacts requires a descriptive User-Agent.
USER_AGENT = "NutriWise/0.1 (capstone project; contact: team@nutriwise.example)"

SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl"
REQUEST_TIMEOUT = 8  # seconds
DEFAULT_PAGE_SIZE = 5

# Fields we ask OFF to return, keeps the payload small. generic_name(_de)
# is OFF's "Allgemeine Bezeichnung" -- a category-level description (e.g.
# "Pizza mit Schinken und Käse") that's often a better match target than a
# brand-heavy product_name, especially against abbreviated receipt text.
_FIELDS = "code,product_name,product_name_de,generic_name,generic_name_de,brands,stores,nutriments,nova_group"

# OFF reports iron and calcium as grams per 100g (like all its "_100g"
# nutrient fields); the rest of this app works in mg (see
# NutritionValues.iron_mg/calcium_mg and the RDA-style mg/day references
# in nutrient_requirements.py). Note: "nutriments" is already requested
# in full above, so iron_100g/calcium_100g come back with it — no
# separate field needed in _FIELDS.
_G_TO_MG = 1000

_CACHE_PATH = Path(__file__).parent / "_off_cache.json"

# Receipt confirm/upload now resolves items concurrently (a thread pool in
# api/receipts.py -- OFF lookups are network-bound, so that's where the
# real win is), which means multiple threads can hit this cache at once.
# Guards the read-merge-write cycle below so two threads racing on
# DIFFERENT keys can't silently lose each other's write (each would
# otherwise load the same pre-update snapshot and overwrite the other's
# save) -- doesn't serialize the network fetch itself, only the fast
# local read/save either side of it.
_cache_lock = threading.Lock()


# ─────────────────────────────────────────────────────────────
# Cache (simple JSON file keyed by normalized query)
# ─────────────────────────────────────────────────────────────

def _load_cache() -> dict:
    if _CACHE_PATH.exists():
        try:
            return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_cache(cache: dict) -> None:
    try:
        _CACHE_PATH.write_text(
            json.dumps(cache, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        # Cache is best-effort; never let a write failure break a lookup.
        pass


# ─────────────────────────────────────────────────────────────
# Search
# ─────────────────────────────────────────────────────────────

def _fetch_off(
    query: str, page_size: int, store: Optional[str] = None, max_retries: int = 3
) -> tuple[List[dict], bool]:
    """
    Query the OFF search endpoint with retry/backoff on rate limiting.

    `store`, when given, scopes the search to OFF's `stores_tags` facet
    (verified live: `stores_tags=rewe` correctly filters to products
    tagged as sold at REWE, and degrades to an empty result set -- not an
    error -- for a store OFF has no tagged products for). Callers treat
    this as a soft boost, retrying without it on an empty result, since
    German regional-chain coverage in OFF's `stores` field is patchy.

    Returns (products, rate_limited). Never raises. `rate_limited` is True
    only when every attempt was met with 429/503 -- OFF's own rate-limit or
    temporary-outage signal -- which is a genuine "couldn't ask" state, not
    the same as asking and confirming zero results.
    """

    params = {
        "search_terms": query,
        "search_simple": 1,
        "action": "process",
        "json": 1,
        "page_size": page_size,
        "fields": _FIELDS,
    }
    if store:
        params["stores_tags"] = store.strip().lower()

    rate_limited = False
    for attempt in range(max_retries):
        try:
            resp = requests.get(
                SEARCH_URL,
                params=params,
                headers={"User-Agent": USER_AGENT},
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code in (429, 503):
                # Rate limited / temporarily unavailable -> back off and retry.
                rate_limited = True
                time.sleep(1.5 * (attempt + 1))
                continue
            resp.raise_for_status()
            return resp.json().get("products", []) or [], False
        except (requests.RequestException, ValueError):
            rate_limited = False
            time.sleep(1.0 * (attempt + 1))
            continue

    return [], rate_limited


def _search_products_impl(
    query: str, page_size: int, store: Optional[str]
) -> tuple[List[dict], bool]:
    """Shared implementation behind search_products/search_products_with_status.

    `store`, when given, first tries a store-scoped search (see
    `_fetch_off`'s docstring); an empty (and not rate-limited) result falls
    back to the plain unfiltered search rather than returning nothing,
    since a store-scoped miss is far more likely to mean "OFF has no store
    tag for this chain" than "this product genuinely isn't sold there" --
    a hard filter would turn weak results into zero results. Skipped when
    the store-scoped attempt was itself rate-limited, since a second
    attempt would just spend more retries hitting the same limit.

    Cached by (lowercased query, lowercased store) -- but only a confirmed
    result (empty or not) is cached; a rate-limited outcome is never
    cached, so the very next call retries live rather than being frozen
    into a false "no results" for the rest of this process's lifetime.
    """

    key = f"{query.strip().lower()}|{(store or '').strip().lower()}"
    if not query.strip():
        return [], False

    with _cache_lock:
        cache = _load_cache()
        if key in cache:
            return cache[key][:page_size], False

    # Network fetch deliberately happens outside the lock -- this is the
    # slow part, and the whole point of resolving items concurrently is
    # that these can overlap across threads. A duplicate concurrent fetch
    # for the same brand-new key is possible (harmless, just a wasted
    # request) but no write is ever lost.
    products, rate_limited = _fetch_off(query, page_size, store=store)
    if not products and store and not rate_limited:
        products, rate_limited = _fetch_off(query, page_size)

    if products:
        with _cache_lock:
            # Reload rather than reuse the snapshot from above -- another
            # thread may have saved its own new key in the meantime, and
            # writing that stale copy back would silently drop it.
            cache = _load_cache()
            cache[key] = products
            _save_cache(cache)

    return products[:page_size], rate_limited


def search_products(query: str, page_size: int = DEFAULT_PAGE_SIZE, store: Optional[str] = None) -> List[dict]:
    """Return a list of candidate OFF products for a product name. Returns
    [] on persistent failure (never raises) -- callers that don't need to
    distinguish "confirmed no match" from "couldn't reach OFF" (the
    automatic resolver, matcher.py) use this; the Fix-match manual search
    (api/match.py) uses search_products_with_status instead, so it can show
    an honest rate-limited note rather than implying there's no match."""

    products, _ = _search_products_impl(query, page_size, store)
    return products


def search_products_with_status(
    query: str, page_size: int = DEFAULT_PAGE_SIZE, store: Optional[str] = None
) -> tuple[List[dict], bool]:
    """Same search as search_products, but also returns whether OFF's rate
    limit (or a temporary outage) was hit -- see _search_products_impl."""

    return _search_products_impl(query, page_size, store)


# ─────────────────────────────────────────────────────────────
# Nutrition extraction
# ─────────────────────────────────────────────────────────────

def _to_float(value) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def extract_nutrition(product: dict) -> NutritionValues:
    """Pull the MVP nutrition dimensions out of an OFF product dict."""

    nutriments = product.get("nutriments", {}) or {}
    iron_g = _to_float(nutriments.get("iron_100g"))
    calcium_g = _to_float(nutriments.get("calcium_100g"))
    return NutritionValues(
        protein_g=_to_float(nutriments.get("proteins_100g")),
        fat_g=_to_float(nutriments.get("fat_100g")),
        carbs_g=_to_float(nutriments.get("carbohydrates_100g")),
        saturated_fat_g=_to_float(nutriments.get("saturated-fat_100g")),
        fiber_g=_to_float(nutriments.get("fiber_100g")),
        sugar_g=_to_float(nutriments.get("sugars_100g")),
        calories_kcal=_to_float(nutriments.get("energy-kcal_100g")),
        processed_score=_to_float(product.get("nova_group")),
        iron_mg=iron_g * _G_TO_MG if iron_g is not None else None,
        calcium_mg=calcium_g * _G_TO_MG if calcium_g is not None else None,
    )


def product_display_name(product: dict) -> str:
    """Best available human-readable name (prefers German). Falls back to
    the generic name (OFF's "Allgemeine Bezeichnung", e.g. "Pizza mit
    Schinken und Käse") when neither product_name field is set -- rare as
    a display name, but better than an empty string."""

    return (
        product.get("product_name_de")
        or product.get("product_name")
        or product.get("generic_name_de")
        or product.get("generic_name")
        or ""
    ).strip()


def product_match_text(product: dict) -> List[str]:
    """Every name field worth scoring a query against: the display-name
    fields plus both generic_name variants, deduplicated, non-empty. A
    branded product_name ("Ristorante Pizza Prosciutto Funghi") can miss a
    receipt's abbreviated text where the category-level generic_name
    ("Pizza mit Schinken und Champignons") hits -- scoring against both
    (services/matcher.py, api/match.py) lets the better of the two win,
    the same "best of several name fields" approach bls_matcher.py already
    uses for name_de/name_en."""

    seen: List[str] = []
    for field in ("product_name_de", "product_name", "generic_name_de", "generic_name"):
        value = (product.get(field) or "").strip()
        if value and value not in seen:
            seen.append(value)
    return seen

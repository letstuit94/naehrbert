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

# Fields we ask OFF to return, keeps the payload small.
_FIELDS = "code,product_name,product_name_de,brands,nutriments,nova_group"

# OFF reports iron and calcium as grams per 100g (like all its "_100g"
# nutrient fields); the rest of this app works in mg (see
# NutritionValues.iron_mg/calcium_mg and the RDA-style mg/day references
# in nutrient_requirements.py). Note: "nutriments" is already requested
# in full above, so iron_100g/calcium_100g come back with it — no
# separate field needed in _FIELDS.
_G_TO_MG = 1000

_CACHE_PATH = Path(__file__).parent / "_off_cache.json"


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

def _fetch_off(query: str, page_size: int, max_retries: int = 3) -> List[dict]:
    """
    Query the OFF search endpoint with retry/backoff on rate limiting.

    Returns [] on persistent failure (never raises). 429/503 responses
    are retried with a linear backoff before giving up.
    """

    params = {
        "search_terms": query,
        "search_simple": 1,
        "action": "process",
        "json": 1,
        "page_size": page_size,
        "fields": _FIELDS,
    }

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
                time.sleep(1.5 * (attempt + 1))
                continue
            resp.raise_for_status()
            return resp.json().get("products", []) or []
        except (requests.RequestException, ValueError):
            time.sleep(1.0 * (attempt + 1))
            continue

    return []


def search_products(query: str, page_size: int = DEFAULT_PAGE_SIZE) -> List[dict]:
    """
    Return a list of candidate OFF products for a product name.

    Cached by (lowercased) query. Only non-empty results are cached, so a
    transient rate-limit/empty response is retried on the next call rather
    than frozen. Returns [] on persistent failure.
    """

    key = query.strip().lower()
    if not key:
        return []

    cache = _load_cache()
    if key in cache:
        return cache[key][:page_size]

    products = _fetch_off(query, page_size)

    if products:
        cache[key] = products
        _save_cache(cache)

    return products[:page_size]


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
    """Best available human-readable name (prefers German)."""

    return (
        product.get("product_name_de")
        or product.get("product_name")
        or ""
    ).strip()

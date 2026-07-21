"""
Cart diversity read-out (Epic 6.2) — net-new logic, no old-repo
equivalent to port.

For each macro group (protein/fat/carb sources), each item's calorie
contribution to that macro is summed by product name, then turned into a
concentration index (Herfindahl-Hirschman style: sum of each source's
squared share). `diversity_score = (1 - HHI) * 100` is 0 when a single
product supplies 100% of a macro and approaches 100 as contributions
spread evenly across many distinct products.

Reads each item's already-persisted matched nutrition (the flat
protein_g/fat_g/carbs_g columns Epic 4.1 writes onto receipt_items at
confirm time) rather than re-running the resolver — see
basket_composition.py's docstring for why that distinction matters.
"""

from collections import defaultdict
from typing import List

from backend.app.services.nutrition_profile import grams_for

_MACRO_KCAL_PER_G = {"protein": 4.0, "fat": 9.0, "carb": 4.0}

# A single source supplying at least this share of a macro's calories is
# called out by name in the plain-language recommendation.
_DOMINANT_SHARE_PCT = 50.0


def compute_diversity(receipt_items: List[dict]) -> dict:
    contributions = {"protein": defaultdict(float), "fat": defaultdict(float), "carb": defaultdict(float)}

    for item in receipt_items:
        if item.get("calories_kcal") is None:
            continue
        grams = grams_for(item.get("quantity"), item.get("unit"), item.get("category"), item.get("name"))
        factor = grams / 100.0
        name = item.get("matched_name") or item.get("name") or "unknown item"
        for macro, field in (("protein", "protein_g"), ("fat", "fat_g"), ("carb", "carbs_g")):
            grams_val = item.get(field)
            if grams_val:
                contributions[macro][name] += grams_val * _MACRO_KCAL_PER_G[macro] * factor

    groups = {}
    recommendations = []
    for macro, sources in contributions.items():
        total = sum(sources.values())
        if total <= 0:
            groups[macro] = {"diversity_score": None, "source_count": 0, "top_source": None, "top_share_pct": None}
            continue

        shares = {name: kcal / total for name, kcal in sources.items()}
        hhi = sum(s ** 2 for s in shares.values())
        top_name, top_share = max(shares.items(), key=lambda kv: kv[1])
        top_share_pct = round(top_share * 100, 1)

        groups[macro] = {
            "diversity_score": round((1 - hhi) * 100, 1),
            "source_count": len(sources),
            "top_source": top_name,
            "top_share_pct": top_share_pct,
        }
        if top_share_pct >= _DOMINANT_SHARE_PCT:
            recommendations.append(
                f"{top_share_pct:.0f}% of your {macro} comes from {top_name} — consider adding variety."
            )

    return {**groups, "recommendations": recommendations}

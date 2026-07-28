"""
Cart diversity read-out (Epic 6.2) — net-new logic, no old-repo
equivalent to port.

For each macro group (protein/fat/carb sources), each item's calorie
contribution to that macro is summed by product name, then turned into a
concentration index (Herfindahl-Hirschman style: sum of each source's
squared share). `diversity_score = (1 - HHI) * 100` is 0 when a single
product supplies 100% of a macro and approaches 100 as contributions
spread evenly across many distinct products.

Fiber gets the same treatment but weighted by grams contributed rather than
kcal -- fiber isn't part of the 3-way %-of-calories split (see
ideal_profile.py's FIBER_G_PER_1000KCAL), so "share of calories" wouldn't
mean anything for it; "share of total fiber" is the direct analog.

`top_drivers` is a separate ranking from the above: it's the purchased
items with the highest per-100g density for that macro (the stored
protein_g/fat_g/carbs_g/fiber_g reference value itself, deduped by name,
not scaled by how much was bought) -- "which of the foods you buy are
concentrated sources of this", not "what's actually driving your total"
(that's what diversity_score/top_source above already answer).

Reads each item's already-persisted matched nutrition (the flat
protein_g/fat_g/carbs_g/fiber_g columns Epic 4.1 writes onto receipt_items
at confirm time) rather than re-running the resolver — see
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
    contributions = {
        "protein": defaultdict(float),
        "fat": defaultdict(float),
        "carb": defaultdict(float),
        "fiber": defaultdict(float),
    }
    # Per-100g density by name, for top_drivers -- first value wins (same
    # product should report the same density on every purchase).
    density = {"protein": {}, "fat": {}, "carb": {}, "fiber": {}}

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
                density[macro].setdefault(name, grams_val)
        fiber_val = item.get("fiber_g")
        if fiber_val:
            contributions["fiber"][name] += fiber_val * factor
            density["fiber"].setdefault(name, fiber_val)

    groups = {}
    recommendations = []
    for macro, sources in contributions.items():
        total = sum(sources.values())
        if total <= 0:
            groups[macro] = {
                "diversity_score": None,
                "source_count": 0,
                "top_source": None,
                "top_share_pct": None,
                "top_drivers": [],
            }
            continue

        shares = {name: kcal / total for name, kcal in sources.items()}
        hhi = sum(s ** 2 for s in shares.values())
        top_name, top_share = max(shares.items(), key=lambda kv: kv[1])
        top_share_pct = round(top_share * 100, 1)
        ranked_density = sorted(density[macro].items(), key=lambda kv: kv[1], reverse=True)[:10]

        groups[macro] = {
            "diversity_score": round((1 - hhi) * 100, 1),
            "source_count": len(sources),
            "top_source": top_name,
            "top_share_pct": top_share_pct,
            "top_drivers": [
                {"name": name, "grams_per_100g": round(value, 1)} for name, value in ranked_density
            ],
        }
        if top_share_pct >= _DOMINANT_SHARE_PCT:
            recommendations.append(
                f"{top_share_pct:.0f}% of your {macro} comes from {top_name} — consider adding variety."
            )

    return {**groups, "recommendations": recommendations}

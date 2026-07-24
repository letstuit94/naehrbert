"""
One-off backfill: classify dietary_label for every recipe generated before
that column existed (GeminiRecipeSuggestion.dietary_label, added alongside
the Recipes page's Meat/Fish/Veggie/Vegan filter). Those rows read back
with dietary_label=None, which the filter always shows regardless of which
buttons are active -- harmless, but means the filter has nothing to act on
until either new recipes are generated or old ones are classified here.

Classifies from each recipe's stored ingredient list via
gemini_client.classify_dietary_label -- one Gemini call per recipe still
missing a label. Only touches rows where dietary_label IS NULL, so running
this again after new (already-labeled) recipes exist is a no-op for those.

Run from the repo root: `python -m backend.scripts.backfill_recipe_dietary_labels`
"""

from backend.app.db import repo
from backend.app.db.supabase import get_client
from backend.app.services.gemini_client import classify_dietary_label


def backfill_recipe_dietary_labels() -> None:
    rows = (
        get_client()
        .table("recipes")
        .select("id, title, ingredients")
        .is_("dietary_label", "null")
        .is_("archived_at", "null")
        .execute()
        .data
        or []
    )

    total = 0
    failed = 0
    for row in rows:
        ingredient_names = [ing["name"] for ing in (row.get("ingredients") or [])]
        if not ingredient_names:
            print(f"  skip {row['title']!r} (no ingredients stored)")
            continue
        try:
            label = classify_dietary_label(ingredient_names)
        except Exception as exc:  # noqa: BLE001 -- best-effort backfill, keep going
            failed += 1
            print(f"  FAILED {row['title']!r}: {exc}")
            continue
        repo.update_recipe(row["id"], {"dietary_label": label.value})
        total += 1
        print(f"  {row['title']!r} -> {label.value}")

    print(f"\nClassified {total} recipe(s); {failed} failed; {len(rows)} were missing a label.")


if __name__ == "__main__":
    backfill_recipe_dietary_labels()

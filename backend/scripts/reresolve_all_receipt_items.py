"""
One-off backfill: re-resolve every existing receipt_item now that Tier 0
(services/verified_matches.py) matches on product name alone, not
(name, store). Items that previously missed a verified match only because
their correction happened to be recorded under a different store will now
pick it up. Re-runs resolve_item() for every non-non-food item across
every receipt (pending and confirmed).

Run from the repo root: `python -m backend.scripts.reresolve_all_receipt_items`
"""

from backend.app.db import repo
from backend.app.db.supabase import get_client
from backend.app.services.nutrition_mapping import matched_product_to_row
from backend.app.services.resolver import resolve_item


def reresolve_all_receipt_items() -> None:
    receipts = get_client().table("receipts").select("id").execute().data or []

    total = 0
    changed = 0
    for receipt in receipts:
        for item in repo.get_receipt_items(receipt["id"]):
            if item.get("is_non_food"):
                continue
            total += 1
            before = item.get("match_type")
            matched = resolve_item(item)
            if matched.match_type.value != before:
                changed += 1
            repo.update_receipt_item(item["id"], matched_product_to_row(matched))

    print(f"Re-resolved {total} items across {len(receipts)} receipts; {changed} changed match tier.")


if __name__ == "__main__":
    reresolve_all_receipt_items()

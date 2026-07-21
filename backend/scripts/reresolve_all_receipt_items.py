"""
One-off backfill: re-resolve every existing receipt_item now that
resolve_item actually receives the parent receipt's store.

Before that fix (backend/app/api/receipts.py), every call site passed a
plain receipt_item dict straight to resolve_item() -- but receipt_items
has no `store` column (it lives on the parent receipt), so
resolver._learned()'s item.get("store") was always None. Every Tier-0
verified-match lookup silently ran store-agnostic-only, missing any row
recorded under a real store -- i.e. nearly all of them (only 1 of 191
verified_matches rows has an empty store). This re-runs resolve_item() for
every non-non-food item across every receipt (pending and confirmed) so
already-uploaded items pick up the verified matches they should have
gotten the first time, instead of staying stuck with whatever weaker
match (OFF/BLS fuzzy, or category fallback) they got before the fix.

Run from the repo root: `python -m backend.scripts.reresolve_all_receipt_items`
"""

from backend.app.db import repo
from backend.app.db.supabase import get_client
from backend.app.services.nutrition_mapping import matched_product_to_row
from backend.app.services.resolver import resolve_item


def reresolve_all_receipt_items() -> None:
    receipts = get_client().table("receipts").select("id, store").execute().data or []

    total = 0
    changed = 0
    for receipt in receipts:
        for item in repo.get_receipt_items(receipt["id"]):
            if item.get("is_non_food"):
                continue
            total += 1
            before = item.get("match_type")
            matched = resolve_item({**item, "store": receipt.get("store")})
            if matched.match_type.value != before:
                changed += 1
            repo.update_receipt_item(item["id"], matched_product_to_row(matched))

    print(f"Re-resolved {total} items across {len(receipts)} receipts; {changed} changed match tier.")


if __name__ == "__main__":
    reresolve_all_receipt_items()

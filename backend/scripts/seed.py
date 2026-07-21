"""
Local dev seed (Epic 0.2): one fake profile + one sample receipt, parsed
from a real fixture in the repo-root `receipts_stu/` folder and run
through the full upload -> match -> confirm pipeline, so /analysis/* has
something to show on a fresh clone without a real receipt on hand.

Run from the repo root: `python -m backend.scripts.seed`
"""

from pathlib import Path

from backend.app.db import repo
from backend.app.services import local_extractor, non_food_terms, receipt_text_parser
from backend.app.services.nutrition_mapping import matched_product_to_row
from backend.app.services.resolver import resolve_item

_SAMPLE_RECEIPT = Path(__file__).resolve().parents[2] / "receipts_stu" / "Netto_Kassenbon_20260702-191137.pdf"

# This specific fixture mixes groceries with household paper products
# (toilet paper, trash bags) that the static non-food keyword list doesn't
# catch (it's tuned for deposits/bags-at-checkout, not every household SKU
# a supermarket sells) — in the real app, Epic 3.4's review screen is where
# a user marks these non-food before confirming. Hardcoded here (by exact
# receipt line) rather than a generic keyword guess, since this seed
# script already hardcodes which one fixture it uses.
_KNOWN_NON_FOOD_LINES = {"Favora Topa 3lg. 10x220BL", "Pri.Zugb.muellbtl.25x60L"}

_FAKE_PROFILE = {
    "sex": "female",
    "date_of_birth": "1994-03-15",
    "height_cm": 168,
    "weight_kg": 64,
    "exercise_frequency": "three_four",
    "daily_movement": "mixed",
    "goal": "maintain",
}


def seed_profile() -> None:
    repo.upsert_profile(_FAKE_PROFILE)
    print("Seeded profile.")


def seed_receipt() -> None:
    file_bytes = _SAMPLE_RECEIPT.read_bytes()
    raw_text = local_extractor.extract_text(file_bytes, _SAMPLE_RECEIPT.name)
    parsed = non_food_terms.filter_learned_non_food(receipt_text_parser.parse_receipt_text_offline(raw_text))

    receipt = repo.create_receipt(
        source="pdf", raw_text=raw_text, store=parsed.get("store"), purchased_at=parsed.get("date"),
    )
    items = [
        {
            "name": item["name"],
            "original_text": item["original_text"],
            "quantity": item["quantity"],
            "unit": item["unit"],
            "price": item["price"],
            "category": item["category"],
            "uncertain": item.get("uncertain", False),
            "is_non_food": item["original_text"] in _KNOWN_NON_FOOD_LINES,
        }
        for item in parsed["items"]
    ]
    saved_items = repo.insert_receipt_items(receipt["id"], items)
    print(f"Seeded receipt {receipt['id']} ({_SAMPLE_RECEIPT.name}) with {len(saved_items)} items.")

    for item in saved_items:
        if item.get("is_non_food"):
            continue
        matched = resolve_item({**item, "store": receipt.get("store")})
        repo.update_receipt_item(item["id"], matched_product_to_row(matched))

    repo.set_receipt_status(receipt["id"], "confirmed")
    print("Matched and confirmed the seeded receipt.")


if __name__ == "__main__":
    seed_profile()
    seed_receipt()

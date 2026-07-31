"""
Local dev seed (Epic 0.2): one fake profile + one sample receipt, parsed
from a small synthetic Netto-style eBon text (not a real purchase) and run
through the full upload -> match -> confirm pipeline, so /analysis/* has
something to show on a fresh clone without a real receipt on hand.

Run from the repo root: `python -m backend.scripts.seed`
"""

from backend.app.db import repo
from backend.app.services import non_food_terms, receipt_text_parser
from backend.app.services.nutrition_mapping import matched_product_to_row
from backend.app.services.resolver import resolve_item

_SAMPLE_RECEIPT_NAME = "synthetic-seed-receipt"
# A made-up Netto eBon in the parser's BLOCK layout (name line, then price
# on the next line -- see receipt_text_parser's module docstring). Mixes
# groceries with two household paper products (toilet paper, a trash bag)
# that the static non-food keyword list doesn't catch (it's tuned for
# deposits/bags-at-checkout, not every household SKU a supermarket sells)
# -- in the real app, Epic 3.4's review screen is where a user marks these
# non-food before confirming.
_SAMPLE_RECEIPT_TEXT = """
Netto Marken-Discount
Filiale 4711

Vollmilch 3,5% 1L
1,19
Roggenbrot 500g
2,49
Naturjoghurt 500g
0,89
Eier 10er Freiland
2,99
Bio Bananen
1,266 kg x
1,29 EUR/kg
1,63
Paprika rot
0,286 kg x
3,49 EUR/kg
1,00
Zewa Toilettenpapier 10x220Bl
4,99
Muellsack 25x60L
1,79

Zu zahlen EUR 16,97
Geg. EC-Cash EUR 16,97
"""

_KNOWN_NON_FOOD_LINES = {"Zewa Toilettenpapier 10x220Bl", "Muellsack 25x60L"}

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
    raw_text = _SAMPLE_RECEIPT_TEXT
    parsed = non_food_terms.filter_learned_non_food(receipt_text_parser.parse_receipt_text_offline(raw_text))

    receipt = repo.create_receipt(
        source="pasted_text", raw_text=raw_text, store=parsed.get("store"), purchased_at=parsed.get("date"),
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
    print(f"Seeded receipt {receipt['id']} ({_SAMPLE_RECEIPT_NAME}) with {len(saved_items)} items.")

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

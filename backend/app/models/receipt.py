"""
Parsed-receipt schema (Epic 3.3) — written fresh for this rebuild rather
than ported, since the old repo's models/receipt.py was only used by its
own API layer (which we rewrite) and wasn't imported by any of the ported
parsing/matching modules. Field names mirror the actual dict shape
`receipt_text_parser.parse_receipt_text_offline` returns.
"""

from typing import List, Optional

from pydantic import BaseModel


class ParsedReceiptItem(BaseModel):
    name: str
    original_text: str
    quantity: float
    unit: str
    price: float
    category: str
    uncertain: bool = False


class ParsedReceipt(BaseModel):
    store: Optional[str] = None
    date: Optional[str] = None
    scan_quality: str
    items: List[ParsedReceiptItem]
    non_food_items_ignored: List[str] = []
    items_count: int

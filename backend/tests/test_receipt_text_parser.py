"""
Pure parsing-logic tests for receipt_text_parser.py -- synthetic text, no
OCR/image fixtures involved (see test_receipt_extraction_and_parsing.py for
the real-fixture end-to-end tests).
"""

from backend.app.services.receipt_text_parser import parse_receipt_text_offline


def test_meat_cuts_containing_brust_are_not_dropped():
    """Regression test: _SKIP_KEYWORDS used to include the bare substring
    "ust" (meant for "USt." VAT lines), which also matched inside "Brust"
    (breast) -- silently dropping every chicken/turkey breast item. Found
    via a real end-to-end browser test where "Hähnchenbrustfilet" vanished
    from the parsed items with no error and no non-food flag."""

    # 3+ "lone price" lines are needed to trigger block-layout detection
    # (_detect_block_layout) -- matches the real receipt this was found on.
    text = (
        "Kichererbsen 265g\n"
        "0,59\n"
        "B\n"
        "Hähnchenbrustfilet 400g\n"
        "3,99\n"
        "B\n"
        "Putenbrust 300g\n"
        "2,49\n"
        "B\n"
        "ZU ZAHLEN 7,07 EUR\n"
    )
    parsed = parse_receipt_text_offline(text)
    names = [item["name"] for item in parsed["items"]]
    assert any("hähnchenbrustfilet" in n.lower() for n in names)
    assert any("putenbrust" in n.lower() for n in names)
    assert parsed["items_count"] == 3


def test_block_layout_stops_at_zu_zahlen_not_only_summe():
    """The block parser's totals-break used to only recognize "summe",
    missing "Zu zahlen" -- a very common German till phrase (seen on real
    ALDI receipts) -- which risked picking up payment/signature noise
    after it as fake items."""

    # 3+ "lone price" lines are needed to trigger block-layout detection.
    text = (
        "RUCOLA\n"
        "0,89\n"
        "RADIESCHEN\n"
        "0,69\n"
        "KOHLRABI\n"
        "0,49\n"
        "ZU ZAHLEN 2,07 EUR\n"
        "Kartenzahlung\n"
        "Nicht_ein_echtes_produkt 9,99\n"
    )
    parsed = parse_receipt_text_offline(text)
    names = [item["name"].lower() for item in parsed["items"]]
    assert not any("nicht_ein_echtes_produkt" in n for n in names)


def test_inline_layout_basic_item_and_price():
    text = "Banane Fair Bio 2,35 A\n0,950 kg x 0,89 EUR/kg\n"
    parsed = parse_receipt_text_offline(text)
    assert parsed["items_count"] == 1
    item = parsed["items"][0]
    assert item["name"] == "Banane Fair Bio"
    assert item["price"] == 2.35
    assert item["quantity"] == 0.95
    assert item["unit"] == "kg"


def test_non_food_keyword_filters_deposit_lines():
    text = "Pfand 0,25 A\nApfel 0,99 A\n"
    parsed = parse_receipt_text_offline(text)
    names = [item["name"] for item in parsed["items"]]
    assert "Apfel" in names
    assert not any("pfand" in n.lower() for n in names)
    assert parsed["non_food_items_ignored"]


def test_product_name_ending_in_x_does_not_trigger_false_multiplier():
    """Regression: _QTY_MULT_RE's "x N" multiplier pattern had no word
    boundary before the "x", so it also matched the bare "x" inside a
    product name ending in one ("Mix", "Fix", ...), misreading the pack
    size as an "x400" multiplier and leaving it un-stripped from the name.
    Found on a real receipt photo whose OCR turned "Mix" into "Hix", but
    the same bug reproduces on the original, un-OCR'd "Mix" text too."""

    text = "Bio Paprika Mix 400g 2,29 B\nAnderes Produkt 300g 1,49 B\nDrittes Produkt 200g 0,99 B\n"
    parsed = parse_receipt_text_offline(text)
    item = next(i for i in parsed["items"] if "paprika" in i["name"].lower())
    assert item["name"] == "Bio Paprika Mix"
    assert item["quantity"] == 400
    assert item["unit"] == "g"


def test_price_line_tolerates_trailing_period_after_tax_letter():
    """Regression: a real WhatsApp-photo receipt OCR'd a stray period after
    the tax-class letter ("2,29 B ."), which _PRICE_RE's trailing-cruft
    class (letters/digits/pipe/bracket) didn't include, silently dropping
    the whole line."""

    text = "Bio Paprika Mix 400g 2,29 B .\nAnderes Produkt 300g 1,49 B .\n"
    parsed = parse_receipt_text_offline(text)
    assert parsed["items_count"] == 2
    assert parsed["items"][0]["price"] == 2.29


def test_kartenzuehlung_ocr_variant_is_filtered_like_kartenzahlung():
    """Regression: the same a->u umlaut OCR substitution seen on "rabatt"
    ("rabatt"/"räbatt") also hit "Kartenzahlung" on a real receipt photo
    ("Kartenzühlung"), which the bare "zahlung" skip keyword didn't cover,
    letting the payment-method line through as a fake product."""

    text = "Apfel 0,99 A\nKartenzühlung EUR 13,36\n"
    parsed = parse_receipt_text_offline(text)
    names = [item["name"].lower() for item in parsed["items"]]
    assert not any("kartenzühlung" in n for n in names)

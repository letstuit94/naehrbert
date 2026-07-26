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


def test_products_containing_tel_are_not_dropped():
    """Regression test: _SKIP_KEYWORDS used to include the bare substring
    "tel" (meant for "Tel:"/"Telefon:" header lines), which also matched
    inside "Nutella", "Kotelett", "Tortellini", "Stelze" -- silently
    dropping any of those. A genuine phone-number header line must still
    be skipped (now via _PHONE_LINE_RE, which requires a word boundary
    before "tel" -- something none of those product names have)."""

    text = (
        "REWE\n"
        "01.06.2026\n"
        "Tel.: 0221 1234567\n"
        "Nutella 400g\n"
        "2,79\n"
        "Kotelett 350g\n"
        "4,49\n"
        "Tortellini 250g\n"
        "2,29\n"
        "Stelze 500g\n"
        "3,99\n"
        "ZU ZAHLEN 13,56 EUR\n"
    )
    parsed = parse_receipt_text_offline(text)
    names = [item["name"].lower() for item in parsed["items"]]
    assert names == ["nutella", "kotelett", "tortellini", "stelze"]


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


def test_multipack_with_measured_size_folds_into_total_amount():
    """A "×N" multiplier next to a MEASURED pack size is folded into a total
    (Commit 2): "Joghurt 150g … x 4" -> 600 g, "Milch 1l … x 3" -> 3 l, so
    the basket shows the real amount instead of a bare count that grams_for
    would misread as 4/3 pieces. A pure count with no measured size (Brötchen
    … x 6) stays a piece count, as before."""

    text = (
        "Joghurt 150g 0,59 x 4 2,36 B\n"
        "Milch 1l 0,99 x 3 2,97 A\n"
        "Broetchen 0,30 x 6 1,80 B\n"
    )
    parsed = parse_receipt_text_offline(text)
    by_name = {i["name"].lower(): i for i in parsed["items"]}

    joghurt = next(i for n, i in by_name.items() if "joghurt" in n)
    assert joghurt["quantity"] == 600  # 4 × 150 g
    assert joghurt["unit"] == "g"

    milch = next(i for n, i in by_name.items() if "milch" in n)
    assert milch["quantity"] == 3  # 3 × 1 l, l not converted to ml
    assert milch["unit"] == "l"

    broetchen = next(i for n, i in by_name.items() if "roetchen" in n)
    assert broetchen["quantity"] == 6  # pure count, no measured size
    assert broetchen["unit"] == "piece"


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


# ── allow_plain_names fallback (manual paste-text entry) ──────────────────

def test_plain_names_without_allow_flag_still_yields_nothing():
    """Without allow_plain_names, a bare name list matches no priced
    heuristic and stays empty -- the flag is opt-in, defaulting to today's
    behavior for file/OCR uploads."""

    parsed = parse_receipt_text_offline("Paprika, Apfel, Huhn")
    assert parsed["items_count"] == 0


def test_plain_names_comma_separated_single_line():
    parsed = parse_receipt_text_offline("Paprika, Apfel, Huhn", allow_plain_names=True)
    names = [item["name"] for item in parsed["items"]]
    assert names == ["Paprika", "Apfel", "Huhn"]
    assert all(item["uncertain"] for item in parsed["items"])


def test_plain_names_one_per_line():
    parsed = parse_receipt_text_offline("Paprika\nApfel\nHuhn", allow_plain_names=True)
    names = [item["name"] for item in parsed["items"]]
    assert names == ["Paprika", "Apfel", "Huhn"]


def test_plain_names_fewer_than_three_items_still_parse():
    """Regression: _detect_block_layout requires 3+ lone-price lines, so a
    short name+price-on-next-line paste (2 items) fell through both priced
    parsers and returned nothing. The plain-names fallback has no minimum
    count -- it recovers the item names even though the now-orphaned price
    lines (no name token to attach to) are dropped."""

    text = "Milch\n1,19\nBanane\n0,99\n"
    parsed = parse_receipt_text_offline(text, allow_plain_names=True)
    names = [item["name"] for item in parsed["items"]]
    assert names == ["Milch", "Banane"]


def test_plain_names_keeps_price_and_quantity_when_present():
    parsed = parse_receipt_text_offline("Milch 1L 1,19, Apfel", allow_plain_names=True)
    by_name = {item["name"]: item for item in parsed["items"]}
    assert by_name["Milch"]["price"] == 1.19
    assert by_name["Milch"]["quantity"] == 1.0
    assert by_name["Milch"]["unit"] == "l"
    assert by_name["Apfel"]["price"] == 0.0


def test_plain_names_filters_non_food_and_noise():
    parsed = parse_receipt_text_offline(
        "Pfand, Apfel, ZU ZAHLEN 3,00 EUR", allow_plain_names=True
    )
    names = [item["name"].lower() for item in parsed["items"]]
    assert names == ["apfel"]
    assert any("pfand" in n.lower() for n in parsed["non_food_items_ignored"])

"""
Offline receipt-text parser (E3) — deterministic, no LLM.

This is now the single parser for ALL inputs: pasted text, OCR'd images,
and PDF text layers (see local_extractor). It runs fully on-device — no API,
no rate limits, no receipt data leaves the host.

German receipts come in two layouts, so the parser auto-detects and handles
both:

  • INLINE — printed/OCR'd tills (Lidl, Edeka) and pasted text:
    the price sits at the END of the item line ("Banane Fair Bio  2,35 A").
  • BLOCK  — digital eBon PDFs (Netto): the item name is on one line and its
    price on the NEXT line, sometimes preceded by a "1,266 kg x / 1,29 EUR/kg"
    weight pair.

Both produce the SAME structured shape (store, date, items[name/quantity/
unit/price/category/uncertain], non_food_items_ignored, items_count), so
everything downstream (matching, nutrition) is identical.
"""

import re
from typing import Optional

from backend.app.services.fallback_categories import _canonical_category
from backend.app.services.units import normalize_quantity, normalize_unit

_STORES = {
    "rewe": "Rewe", "edeka": "Edeka", "aldi": "Aldi", "lidl": "Lidl",
    "penny": "Penny", "netto": "Netto", "norma": "Norma",
}

# Lines that are receipt scaffolding or non-food, never a grocery item.
# "räbatt" alongside "rabatt": a real ALDI receipt OCR'd "Positionsrabatt"
# with an "ä", which silently defeated the plain "rabatt" substring check
# and let a discount line through as if it were a purchased item.
_NONFOOD_KEYWORDS = (
    "pfand", "rabatt", "räbatt", "tüte", "tuete", "tragetasche", "beutel", "coupon",
    "leergut", "tasche",
)
_SKIP_KEYWORDS = (
    # NOTE: no bare "ust" here on purpose -- it was meant to catch "USt."
    # (VAT) lines, but as a substring match it also fires on any product
    # whose name contains "Brust" (breast) -- Hähnchenbrust, Putenbrust,
    # Rinderbrust -- silently dropping those items entirely. "mwst" /
    # "steuer" / "uid" below already cover VAT-related lines without that
    # collision. Found via a real end-to-end test: "Hähnchenbrustfilet"
    # was silently missing from parsed items.
    "summe", "total", "gesamt", "zwischensumme", "mwst", "steuer",
    "ec-", "ec ", "kundenbeleg",
    "geg.", "rückgeld", "ruckgeld", "datum", "uhrzeit", "beleg", "kasse", "vielen dank",
    # store header / address / footer lines
    "gmbh", "markt", "filiale", "straße", "strasse", "str.", "tel", "www", ".de",
    "rewe", "edeka", "aldi", "lidl", "penny", "netto", "norma", "uid", "steuernr",
    # receipt-tail noise that OCR picks up (payment, TSE signature, loyalty).
    # The totals-block break below removes most of it, these catch stragglers.
    # "zühlung" alongside "zahlung": the same a→ü OCR substitution seen on
    # "räbatt" (real receipt: "Kartenzühlung" for "Kartenzahlung").
    "kreditkarte", "kartenzahlung", "girocard", "bezahlung", "zahlung", "zühlung",
    "tse", "prüfwert", "pruefwert", "signatur", "seriennr", "transaktion",
    "terminal", "autorisierung", "genehmigung", "emv", "vu-nummer", "vu-nr",
    "payback", "punkte", "posten", "preisvorteil", "gespart", "servicenummer",
)
# "Geg." (short for "Gegeben" — cash handed over) followed by a payment
# method, tolerating OCR reading the period as a comma ("Geg, BAR EUR 1,20"
# — seen on a real receipt where this cash-tendered line was picked up as
# a fake item because plain "geg." above never matched "geg,").
_CASH_GIVEN_RE = re.compile(r"\bgeg[.,]?\s+(bar|ec|kreditkarte|girocard|karte)\b", re.IGNORECASE)

# trailing price at line end, tolerating OCR cruft after it: a currency
# symbol and/or the German tax-class letters printed next to the price
# ("2,35 A", "0,75 AW", "1,19 A", "3,50 EUR"), and — since real OCR often
# garbles a second stray token after that — up to one more short trailing
# token beyond the first. Found via two real receipts: "LINSEN MIT SG
# 1,19 B SS" silently dropped (no match at all) because the original
# version only tolerated a single trailing letters-block; a batch of real
# ALDI receipts append a stray OCR'd digit/pipe/bracket after the currency
# symbol on every single item ("0,85 € 1", "1,39 € |"), which even the
# widened letters-only version still didn't cover. A real WhatsApp-photo
# receipt OCR'd a tax letter followed by a stray period as its own token
# ("2,29 B ."), which the letters/digits/pipe/bracket class didn't include
# either, so a "." joins the same trailing-token class.
_PRICE_RE = re.compile(
    r"(-?\d{1,4}[.,]\d{2})\s*(?:€|eur)?(?:\s+[a-zäöü%0-9|\[\].]{1,4}){0,2}\s*$", re.IGNORECASE
)
# A real product line has at most a quantity and one final price — never 3+
# decimal amounts. The German "Steuer % Netto Steuer Brutto" tax-breakdown
# row ("B= 7,0% 1,11 0,08 1,19") does, so this structural check catches it
# even when OCR garbles the row's actual words past recognition (seen on a
# real receipt: "Sn DS B= 7,0% 1,11 0,08 1,19 nm" was picked up as a fake
# item because none of its garbled text matched the "steuer" skip keyword).
_DECIMAL_AMOUNT_RE = re.compile(r"\d+[.,]\d{2}")
_TAX_ROW_MIN_AMOUNTS = 3
# the totals block — once we hit it, stop reading items (everything after is
# payment / tax / TSE signature noise).
_TOTAL_RE = re.compile(r"\bsumme\b|zu\s*zahlen|gesamtbetrag|\bgesamt\b|zu\s*zahl", re.IGNORECASE)
# a weight line that qualifies the PREVIOUS item ("1,182 kg x 1,99 EUR/kg").
_WEIGHT_AFTER_RE = re.compile(r"(\d+[.,]\d+)\s*(kg|g|l|ml)\s*x", re.IGNORECASE)
# an explicit "x N" multiplier ("... 4,59 x 2", "... 0,15 € x 5"). The
# leading \b matters: without it this matched the bare "x" inside a
# product name ending in one ("Bio Paprika Mix 400g", "Nuss-Mix 250g"),
# misreading the pack size as an "x400"/"x250" multiplier and leaving the
# weight un-stripped from the item name. Found via a real receipt photo
# whose OCR happened to turn "Mix" into "Hix" — but the same bug already
# reproduced on the original, un-OCR'd "Mix" text once found.
_QTY_MULT_RE = re.compile(r"\bx\s*%?\s*(\d+)")
# quantity + unit anywhere: "500g", "1,0 kg", "1L", "10 Stk", "6 x"
_QTY_RE = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|ltr|l|stk|stück|stueck|st|x|pack|packung|dose|flasche|bund|cl)\b",
    re.IGNORECASE,
)
_DATE_DMY = re.compile(r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})")
_DATE_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def _to_float(s: str) -> Optional[float]:
    try:
        return float(s.replace(".", "").replace(",", ".")) if s.count(",") == 1 and "." in s \
            else float(s.replace(",", "."))
    except (TypeError, ValueError):
        return None


# Store detection scans the HEADER region only (first lines), in priority
# order, so a brand mention in the item area ("Lidl Plus Rabatt") wins over
# the word "Netto" that appears in every receipt's tax table at the bottom.
_STORE_PRIORITY = (
    ("lidl", "Lidl"), ("rewe", "Rewe"), ("e-center", "Edeka"), ("e center", "Edeka"),
    ("edeka", "Edeka"), ("aldi", "Aldi"), ("penny", "Penny"), ("norma", "Norma"),
    ("kaufland", "Kaufland"), ("netto", "Netto"),
)


def _detect_store(lines) -> str:
    head = " ".join(lines[:12]).lower()
    for key, name in _STORE_PRIORITY:
        if key in head:
            return name
    return "unknown"


def _detect_date(text: str) -> Optional[str]:
    m = _DATE_ISO.search(text)
    if m:
        return m.group(0)
    m = _DATE_DMY.search(text)
    if m:
        d, mth, y = m.groups()
        y = ("20" + y) if len(y) == 2 else y
        try:
            return f"{int(y):04d}-{int(mth):02d}-{int(d):02d}"
        except ValueError:
            return None
    return None


# ── Layout detection ─────────────────────────────────────────────────────
_PRICE_ONLY_RE = re.compile(r"^-?\d{1,3}[.,]\d{2}$")            # a lone price line
_INLINE_PRICE_RE = re.compile(r"[a-zäöüß].*\d[.,]\d{2}\s*[a-z]?\s*$", re.IGNORECASE)


def _detect_block_layout(text: str) -> bool:
    """True when the receipt uses the eBon 'block' layout (price on its own
    line) rather than the inline layout (price at the end of the item line)."""

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    lone = sum(1 for ln in lines if _PRICE_ONLY_RE.match(ln))
    inline = sum(1 for ln in lines if _INLINE_PRICE_RE.search(ln))
    return lone >= 3 and lone >= inline


def parse_receipt_text_offline(raw_text: str) -> dict:
    """Parse receipt text into the structured receipt schema — no LLM.

    Dispatches on the detected layout so the same function handles pasted
    text, OCR'd images (inline) and eBon PDF text layers (block)."""

    text = raw_text or ""
    if _detect_block_layout(text):
        return _parse_block(text)
    return _parse_inline(text)


def _clean_name(name: str) -> str:
    """Strip leading OCR junk (‚ / | _ …), collapse spaces, drop stray %."""

    name = re.sub(r"^[^0-9A-Za-zÄÖÜäöüß]+", "", name)      # leading punctuation/noise
    name = re.sub(r"\d+[.,]?\d*\s*%", "", name)            # stray percentages
    name = re.sub(r"\s{2,}", " ", name).strip(" -.,|/_")
    # A trailing standalone "x" (its own token, qty-multiplier residue) is
    # dropped, but not a bare "x" that's part of the last word -- "x" used
    # to sit in the .strip() charset above, which also ate the last letter
    # of any product name ending in one ("Mix" -> "Mi", "Nuss-Mix" -> "Nuss-Mi").
    return re.sub(r"(?:^|\s)x$", "", name, flags=re.IGNORECASE).strip()


def _parse_inline(text: str) -> dict:
    """INLINE layout: price at the end of each item line (tills / OCR / pasted
    text). Robust to OCR reality — trailing tax-class letters on prices,
    quantity multipliers, weighed-goods lines, and payment/TSE tail noise."""

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    store = _detect_store(lines)
    date = _detect_date(text)

    items = []
    non_food = []
    for line in lines:
        low = line.lower()

        # A weight line qualifies the PREVIOUS item: "1,182 kg x 1,99 EUR/kg".
        wm = _WEIGHT_AFTER_RE.search(line)
        if wm and "eur/" in low.replace(" ", ""):
            if items and items[-1]["unit"] == "piece" and items[-1]["quantity"] == 1.0:
                items[-1]["quantity"] = normalize_quantity(_to_float(wm.group(1)) or 1.0, wm.group(2))
                items[-1]["unit"] = normalize_unit(wm.group(2))
            continue

        if _TOTAL_RE.search(line):        # totals block reached → stop reading items
            break
        if _CASH_GIVEN_RE.search(line):   # "Geg./Geg, BAR EUR 1,20" — cash tendered, not an item
            continue
        if len(_DECIMAL_AMOUNT_RE.findall(line)) >= _TAX_ROW_MIN_AMOUNTS:
            continue  # tax-breakdown row (Netto/Steuer/Brutto), not an item
        if any(k in low for k in _NONFOOD_KEYWORDS):
            non_food.append(line)
            continue
        if any(k in low for k in _SKIP_KEYWORDS):
            continue
        if not re.search(r"[a-zäöüß]", low):
            continue  # no letters → not a product line

        # A receipt item always carries a price. No trailing price → this is a
        # header/address/footer/noise line, not an item (this is what keeps OCR
        # cruft like "10999 Berlin" or a TSE hash out of the items list).
        price_m = _PRICE_RE.search(line)
        if not price_m:
            continue
        price = _to_float(price_m.group(1))
        if price is not None and price <= 0:   # a discount/coupon line, not a purchase
            continue
        body = line[: price_m.start()].strip()

        # Quantity: an explicit "x N" multiplier first ("Puten… 4,59 x 2"),
        # otherwise an embedded pack size ("… 1L", "500g", "10 Stk").
        quantity, unit, explicit_qty = 1.0, "piece", False
        mult = _QTY_MULT_RE.search(body)
        if mult:
            quantity, explicit_qty = float(mult.group(1)), True
            body = re.split(r"\d+[.,]\d{2}\s*€?\s*x", body)[0]
        else:
            qty_m = _QTY_RE.search(body)
            if qty_m:
                explicit_qty = True
                quantity = normalize_quantity(_to_float(qty_m.group(1)) or 1.0, qty_m.group(2))
                unit = normalize_unit(qty_m.group(2))
                body = (body[: qty_m.start()] + " " + body[qty_m.end():])

        name = _clean_name(body)
        if not name or len(name) < 2:
            continue

        items.append({
            "name": name,
            "original_text": line,
            "quantity": quantity,
            "unit": unit,
            "price": price,
            "category": _canonical_category(None, name),
            "uncertain": not explicit_qty,   # no explicit qty/unit → flag for review
        })

    return {
        "store": store,
        "date": date,
        "scan_quality": "good" if items else "poor",
        "items": items,
        "non_food_items_ignored": non_food,
        "items_count": len(items),
    }


# ── BLOCK layout (eBon PDFs: name line, price on the next line) ───────────
_WEIGHT_X_RE = re.compile(r"^(\d+[.,]\d+)\s*(kg|g|l|ml|stk)\s*x$", re.IGNORECASE)  # "1,266 kg x"
_UNIT_PRICE_RE = re.compile(r"eur\s*/\s*(kg|g|l|stk)", re.IGNORECASE)            # "1,29 EUR/kg"


def _build_item(name: str, price, weight) -> Optional[dict]:
    """Assemble one item dict from a block-layout name/price (+ optional
    weight pair), reusing the same qty/unit/category normalization as the
    inline path. Returns None for a non-item name."""

    if weight is not None:
        raw_qty, raw_unit = weight
        quantity = normalize_quantity(raw_qty, raw_unit)
        unit = normalize_unit(raw_unit)
        clean = name
    else:
        # pull an embedded pack size out of the name ("… 265g" → 265 g), same
        # convention as the inline parser and the mock fixture.
        qty_m = _QTY_RE.search(name)
        if qty_m:
            quantity = normalize_quantity(_to_float(qty_m.group(1)) or 1.0, qty_m.group(2))
            unit = normalize_unit(qty_m.group(2))
            clean = (name[: qty_m.start()] + " " + name[qty_m.end():]).strip()
        else:
            quantity, unit, clean = 1.0, "piece", name

    clean = re.sub(r"\d+[.,]?\d*\s*%", "", clean).strip(" -.,x")
    if not clean or len(clean) < 2:
        return None
    return {
        "name": clean,
        "original_text": name,
        "quantity": quantity,
        "unit": unit,
        "price": price,
        "category": _canonical_category(None, clean),
        "uncertain": price is None,   # a clean text-layer line with a price is reliable
    }


def _parse_block(text: str) -> dict:
    """BLOCK layout: the item name is on one line and its price on the next,
    optionally preceded by a "1,266 kg x / 1,29 EUR/kg" weight pair."""

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    store = _detect_store(lines)
    date = _detect_date(text)

    items, non_food = [], []
    name, weight = None, None
    for line in lines:
        low = line.lower()
        # Totals block reached → stop. Shares _TOTAL_RE with the inline parser
        # (used to be its own "summe"-only regex, which missed "Zu zahlen" --
        # a common German till phrase, seen on real ALDI receipts).
        if _TOTAL_RE.search(low):
            break

        wm = _WEIGHT_X_RE.match(line)     # remember the weight for the coming item
        if wm:
            weight = (_to_float(wm.group(1)) or 1.0, wm.group(2).lower())
            continue
        if _UNIT_PRICE_RE.search(low):    # "1,29 EUR/kg" — unit-price line, skip
            continue

        if _PRICE_ONLY_RE.match(line):    # a lone price closes the pending item
            if name is not None:
                price = _to_float(line)
                if price is not None and price > 0:
                    if any(k in name.lower() for k in _NONFOOD_KEYWORDS):
                        non_food.append(name)
                    else:
                        item = _build_item(name, price, weight)
                        if item:
                            items.append(item)
                name, weight = None, None
            continue

        if len(line) <= 1 or line in ("B", "A", "EUR", "***"):
            continue
        if any(k in low for k in _SKIP_KEYWORDS):   # header / address / footer noise
            name = None
            continue
        if not re.search(r"[a-zäöüß]", low):         # no letters → not a product name
            continue
        name = line                                  # otherwise: an item name

    return {
        "store": store,
        "date": date,
        "scan_quality": "good" if items else "poor",
        "items": items,
        "non_food_items_ignored": non_food,
        "items_count": len(items),
    }

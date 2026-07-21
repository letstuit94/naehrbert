import json
import os
from pathlib import Path

from dotenv import load_dotenv

from backend.app.services.units import normalize_quantity, normalize_unit

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────
#
# Extraction is now fully LOCAL (see services/local_extractor.py): PDF text
# layers via PyMuPDF and image OCR via Tesseract. This replaced the Gemini
# vision call so the receipt pipeline has NO rate limits, works offline, and
# never sends personal receipt data (card PANs, transaction IDs, PAYBACK
# numbers) to a third-party LLM.

load_dotenv()

# Offline / deterministic mode (E3): when RECEIPT_PARSER_MOCK is truthy, the
# parser returns a fixed fixture instead of running extraction, so the whole
# receipt flow (upload → normalize → classify → store → review) can be
# exercised deterministically in tests. Off by default.
MOCK_MODE = os.environ.get("RECEIPT_PARSER_MOCK", "").strip().lower() in {"1", "true", "yes", "on"}
_MOCK_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "mock_receipt.json"

# Typed extraction error codes (E3-S5). The API layer maps these to HTTP
# statuses (invalid→422, unavailable→503, rate_limited→429). Local extraction
# never rate-limits, so in practice only `invalid` (unreadable file) is
# emitted now; the other codes are kept for the stable API contract.
ERROR_RATE_LIMITED = "rate_limited"
ERROR_UNAVAILABLE = "unavailable"
ERROR_INVALID = "invalid"


# ─────────────────────────────────────────────────────────────
# CORE FUNCTIONS
# ─────────────────────────────────────────────────────────────

def _normalize_parsed(parsed: dict) -> dict:
    """
    Canonicalize a successfully-parsed receipt (E3-S3): map every item's
    free-form unit to the {g,kg,ml,l,piece} enum (scaling the quantity when
    the source unit isn't 1:1, e.g. cl→ml). Non-destructive on error dicts.
    """

    if not isinstance(parsed, dict) or parsed.get("error"):
        return parsed

    for item in parsed.get("items", []) or []:
        raw_unit = item.get("unit")
        item["quantity"] = normalize_quantity(item.get("quantity"), raw_unit)
        item["unit"] = normalize_unit(raw_unit)
    return parsed


def _load_mock() -> dict:
    """Deterministic parsed receipt for RECEIPT_PARSER_MOCK mode (E3)."""

    with open(_MOCK_FIXTURE, encoding="utf-8") as fh:
        return _normalize_parsed(json.load(fh))


def scan_receipt_bytes(
    file_bytes: bytes,
    filename: str,
    max_retries: int = 3,
) -> dict:
    """
    Parse a receipt file (image or PDF) into structured JSON — fully LOCAL.

    Extraction runs on-device (services/local_extractor): PDF text layers via
    PyMuPDF, image OCR via Tesseract. The extracted text is then parsed by the
    shared offline parser into the same schema as the text path, so downstream
    stages are unchanged. No network, no rate limits, no data leaves the host.

    An unreadable / unsupported / corrupt file returns a typed `invalid`
    error (E3-S5 → HTTP 422). `max_retries` is accepted for call-site
    symmetry but unused (there is no upstream to retry).
    """

    if MOCK_MODE:
        return _load_mock()

    from backend.app.services import local_extractor
    from backend.app.services.receipt_text_parser import parse_receipt_text_offline

    try:
        raw_text = local_extractor.extract_text(file_bytes, filename)
    except local_extractor.UnreadableReceipt as e:
        return {"error": str(e), "error_code": ERROR_INVALID}

    return _normalize_parsed(parse_receipt_text_offline(raw_text))


def scan_receipt_text(
    raw_text: str,
    max_retries: int = 3,
) -> dict:
    """
    Parse pasted receipt text into the same structured schema as
    scan_receipt_bytes — fully offline (deterministic parser, no LLM).
    `max_retries` is accepted for call-site symmetry but unused here.

    In mock mode it returns the shared fixture for deterministic
    end-to-end tests.
    """

    if MOCK_MODE:
        return _load_mock()

    from backend.app.services.receipt_text_parser import parse_receipt_text_offline

    return _normalize_parsed(parse_receipt_text_offline(raw_text))
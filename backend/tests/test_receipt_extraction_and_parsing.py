"""
Exercises the ported OCR/extraction + parsing pipeline (Epic 3) against
real sample receipts committed under repo-root `receipts_stu/` and
`receipts_jen/` — actual till printouts and phone photos, not synthetic
fixtures. (Historically `receipts/`, renamed to `receipts_stu` once a
second contributor's `receipts_jen` folder was added.)
"""

from pathlib import Path

import pytest

from backend.app.services import local_extractor, receipt_text_parser

_REPO_ROOT = Path(__file__).resolve().parents[2]
_RECEIPTS_DIRS = [_REPO_ROOT / "receipts_stu", _REPO_ROOT / "receipts_jen"]


def _glob_ci(*suffixes: str) -> list:
    """Case-insensitive glob across all receipts dirs — receipts_jen uses
    upper-case extensions (.JPG/.PNG), receipts_stu lower-case."""

    found = []
    for d in _RECEIPTS_DIRS:
        if not d.is_dir():
            continue
        for path in d.iterdir():
            if path.suffix.lower() in suffixes:
                found.append(path)
    return sorted(found)


_PDF_FIXTURES = _glob_ci(".pdf")
_JPEG_FIXTURES = _glob_ci(".jpg", ".jpeg")
_PNG_FIXTURES = _glob_ci(".png")


@pytest.mark.parametrize("pdf_path", _PDF_FIXTURES, ids=lambda p: p.name)
def test_extract_and_parse_real_netto_pdfs(pdf_path):
    raw_text = local_extractor.extract_text(pdf_path.read_bytes(), pdf_path.name)
    assert raw_text.strip()

    parsed = receipt_text_parser.parse_receipt_text_offline(raw_text)
    assert parsed["items_count"] == len(parsed["items"])
    assert parsed["items_count"] > 0
    for item in parsed["items"]:
        assert item["price"] > 0
        assert item["name"]
        assert item["unit"] in ("g", "kg", "ml", "l", "piece")


@pytest.mark.parametrize("jpeg_path", _JPEG_FIXTURES, ids=lambda p: p.name)
def test_extract_real_jpeg_photos_via_ocr(jpeg_path):
    assert _JPEG_FIXTURES, "expected at least one real jpeg/jpg fixture"
    raw_text = local_extractor.extract_text(jpeg_path.read_bytes(), jpeg_path.name)
    assert raw_text.strip()


def test_extract_real_png_photo_via_ocr():
    assert _PNG_FIXTURES, "expected at least one real png fixture"
    raw_text = local_extractor.extract_text(_PNG_FIXTURES[0].read_bytes(), _PNG_FIXTURES[0].name)
    assert raw_text.strip()


def test_unreadable_bytes_raise_typed_error():
    with pytest.raises(local_extractor.UnreadableReceipt):
        local_extractor.extract_text(b"not a real receipt file", "receipt.pdf")


# ── Regression tests for receipts_jen's rotated/garbled photos ──────────
# IMG_1930-1936 were shot with the receipt sideways in frame — EXIF only
# corrects for how the camera was held, not for that, so they used to OCR
# as pure noise (see local_extractor._ROTATION_RETRY_CONFIDENCE). IMG_1928
# was legible but "LINSEN MIT SG 1,19 B SS" (extra OCR-garbled trailing
# token) silently failed to parse as an item at all — see
# receipt_text_parser._PRICE_RE.

_JEN_DIR = _REPO_ROOT / "receipts_jen"


@pytest.mark.skipif(not _JEN_DIR.is_dir(), reason="receipts_jen fixtures not present")
@pytest.mark.parametrize(
    "filename", ["IMG_1930.JPG", "IMG_1931.JPG", "IMG_1932.JPG", "IMG_1933.JPG", "IMG_1934.JPG", "IMG_1936.JPG"]
)
def test_sideways_photos_now_extract_legible_german_text(filename):
    path = _JEN_DIR / filename
    if not path.exists():
        pytest.skip(f"{filename} not present")
    text = local_extractor.extract_text(path.read_bytes(), filename)
    # A weak but real signal that this is legible German receipt text
    # rather than OCR noise: noise is dominated by punctuation/short
    # fragments, not recognizable words of reasonable length.
    words = [w for w in text.split() if w.isalpha() and len(w) >= 4]
    assert len(words) >= 5, f"expected several real words, got: {text!r}"


@pytest.mark.skipif(not (_JEN_DIR / "IMG_1928.JPG").exists(), reason="IMG_1928.JPG not present")
def test_linsen_item_is_no_longer_dropped_or_replaced_with_garbage():
    path = _JEN_DIR / "IMG_1928.JPG"
    text = local_extractor.extract_text(path.read_bytes(), path.name)
    parsed = receipt_text_parser.parse_receipt_text_offline(text)
    names = [item["name"].lower() for item in parsed["items"]]
    assert any("linsen" in n for n in names), f"expected a Linsen item, got: {parsed['items']}"
    # The two previously-fabricated fake items must not appear.
    assert not any("geg" in n for n in names)
    assert not any(n.startswith("sn ds") for n in names)

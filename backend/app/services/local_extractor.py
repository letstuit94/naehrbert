"""
Local, offline receipt text extraction (E3) — replaces the Gemini vision call.

Motivation: the previous image path sent the raw receipt bytes to Gemini,
which (a) is rate-limited (429s), (b) exposes personal data — card PANs,
transaction IDs, PAYBACK numbers — to a third-party LLM, and (c) needs the
network. This module does the same job fully on-device: no API, no rate
limits, and no receipt data ever leaves the host.

Two engines, chosen by file type (validated end-to-end against real Lidl /
Netto / Edeka receipts in text_extraction.ipynb):

  • PDF   → embedded text layer via PyMuPDF (exact characters, instant).
            Scanned PDFs with no text layer fall back to rendering + OCR.
  • image → Tesseract OCR (German model) with OpenCV preprocessing
            (EXIF-fix → greyscale → upscale → adaptive threshold for photos).

The output is raw text; `receipt_text_parser.parse_receipt_text_offline`
turns it into the structured `ParsedReceipt` schema, so everything
downstream (matching, nutrition) is unchanged.
"""

import io
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np
import pytesseract
from PIL import Image, ImageOps
from pytesseract import Output

# OpenCV gives the best photo preprocessing, but it is an optional heavy
# dependency. If it is missing we degrade to a Pillow-only pipeline so the
# service still runs (slightly lower OCR accuracy on noisy photos).
try:
    import cv2
    _HAVE_CV2 = True
except Exception:  # pragma: no cover - import guard
    _HAVE_CV2 = False


class UnreadableReceipt(Exception):
    """A file could not be turned into text (corrupt, unsupported, or no OCR
    engine available). The parser maps this to a typed ``invalid`` error so
    the API returns 422 instead of crashing."""


_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
_PHOTO_SUFFIXES = {".jpg", ".jpeg"}
_OCR_LANG = "deu"                 # German model — receipts are full of ä ö ü ß
_OCR_CONFIG = "--oem 1 --psm 6"   # LSTM engine, assume a single uniform block

# Below this average per-word confidence (0-100), a phone photo is retried
# at 90/180/270° and whichever rotation scores highest is kept. EXIF only
# corrects for how the camera was physically held (`ImageOps.exif_transpose`
# below) — it says nothing about a receipt photographed sideways or upside
# down within an otherwise "upright" frame, which OCRs as pure noise at 0°.
# Calibrated against 8 real phone photos: images that were actually upright
# scored 57-64 at 0° (and far lower at every other angle); images shot
# sideways scored only 27-34 at 0° but 54-66 at their correct rotation —
# a wide, clean gap either side of 50.
_ROTATION_RETRY_CONFIDENCE = 50.0
_RETRY_ROTATIONS = (90, 180, 270)


def _tesseract_available() -> bool:
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def _preprocess(pil_img: Image.Image, photo: bool) -> Image.Image:
    """Prepare an image for OCR: fix orientation, greyscale, upscale, and
    (for phone photos) denoise + adaptive-threshold to clean black-on-white."""

    img = ImageOps.exif_transpose(pil_img).convert("RGB")   # honour phone rotation

    if _HAVE_CV2:
        g = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2GRAY)
        scale = 2000 / g.shape[1]                            # upscale to ~2000px wide
        if scale > 1:
            g = cv2.resize(g, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        if photo:
            g = cv2.bilateralFilter(g, 7, 50, 50)
            g = cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                      cv2.THRESH_BINARY, 31, 15)
        return Image.fromarray(g)

    # Pillow-only fallback (no OpenCV): greyscale + upscale.
    g = img.convert("L")
    w, h = g.size
    if w < 2000:
        f = 2000 / w
        g = g.resize((int(w * f), int(h * f)))
    return g


def _ocr_confidence(prepped: Image.Image) -> float:
    """Average Tesseract word confidence (0-100) for `prepped` — a cheap
    quality signal used only to decide whether a rotation is worth keeping,
    not the extracted text itself."""

    data = pytesseract.image_to_data(prepped, lang=_OCR_LANG, config=_OCR_CONFIG, output_type=Output.DICT)
    scores = [int(c) for c in data.get("conf", []) if str(c).lstrip("-").isdigit() and int(c) >= 0]
    return (sum(scores) / len(scores)) if scores else 0.0


def _ocr(pil_img: Image.Image, photo: bool) -> str:
    if not _tesseract_available():
        raise UnreadableReceipt(
            "OCR engine (Tesseract) is not installed on this host — "
            "image receipts cannot be read. Install tesseract-ocr + "
            "tesseract-ocr-deu (see Dockerfile)."
        )

    prepped = _preprocess(pil_img, photo)
    if not photo:
        return pytesseract.image_to_string(prepped, lang=_OCR_LANG, config=_OCR_CONFIG)

    best_prepped, best_score = prepped, _ocr_confidence(prepped)
    if best_score < _ROTATION_RETRY_CONFIDENCE:
        for angle in _RETRY_ROTATIONS:
            candidate = _preprocess(pil_img.rotate(angle, expand=True), photo)
            score = _ocr_confidence(candidate)
            if score > best_score:
                best_prepped, best_score = candidate, score

    return pytesseract.image_to_string(best_prepped, lang=_OCR_LANG, config=_OCR_CONFIG)


def _pdf_text(file_bytes: bytes) -> str:
    """Read a PDF's embedded text layer; OCR the rendered pages only if there
    is no text layer (i.e. a scanned PDF)."""

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    text = "\n".join(page.get_text() for page in doc)
    if text.strip():
        return text
    pages = []
    for page in doc:
        pix = page.get_pixmap(dpi=300)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        pages.append(_ocr(img, photo=False))
    return "\n".join(pages)


def extract_text(file_bytes: bytes, filename: str | None) -> str:
    """Turn an uploaded receipt (PDF or image bytes) into raw text, fully
    offline. Raises :class:`UnreadableReceipt` on unsupported / corrupt input."""

    suffix = Path(filename or "").suffix.lower()
    try:
        if suffix == ".pdf":
            return _pdf_text(file_bytes)
        if suffix in _IMAGE_SUFFIXES or suffix == "":
            img = Image.open(io.BytesIO(file_bytes))
            w, h = img.size
            # A large JPEG is almost certainly a phone photo → heavier pipeline;
            # a small/flat PNG or app export is already clean.
            is_photo = suffix in _PHOTO_SUFFIXES and max(w, h) > 2500
            return _ocr(img, photo=is_photo)
        raise UnreadableReceipt(f"Unsupported receipt file type: {suffix or 'unknown'}")
    except UnreadableReceipt:
        raise
    except Exception as e:  # corrupt bytes, bad PDF, decode failure, …
        raise UnreadableReceipt(f"Could not read receipt file: {e}") from e

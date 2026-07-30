"""
BLS (Bundeslebensmittelschlüssel) local matcher — Epic 4 nutrition source.

Matches against the German federal food-composition database (BLS 4.0,
`BLS_data/BLS_4_0_Daten_2025_DE.xlsx`, ~7,140 generic food entries). Used
by the tiered resolver (services/resolver.py) both as a whole-food
identity fallback (E4-S3) and as the OFF→BLS nutrition bridge that borrows
BLS's near-complete macros + micronutrients (E4-S4).

Reuses the *exact same* scoring function and thresholds as the OFF matcher
(`text_similarity.token_similarity`, `matcher.FUZZY_THRESHOLD`,
`matcher.EXACT_THRESHOLD`).

Key structural difference from OFF: BLS is a *generic food composition
table* (e.g. "Tomate, roh"), not a *branded/packaged product catalogue*.
It therefore has near-complete macro + micro data for almost every row,
but: (a) no brand-specific entries, and (b) no NOVA/processing
classification at all — NOVA always comes from OFF (BR-MT3), never here.
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, TypedDict

try:
    import openpyxl
except ModuleNotFoundError:  # only needed to (re)build the cache, not at runtime
    openpyxl = None

from backend.app.services.matcher import EXACT_THRESHOLD, FUZZY_THRESHOLD
from backend.app.services.text_similarity import full_ratio, token_similarity

_XLSX_PATH = Path(__file__).resolve().parents[3] / "BLS_data" / "BLS_4_0_Daten_2025_DE.xlsx"
_CACHE_PATH = Path(__file__).parent / "_bls_cache.json"
_SHEET_NAME = "BLS_4_0_Daten_2025_DE"

# 0-indexed value-column positions in the BLS 4.0 export (verified against
# the header row directly; each metric is followed by Datenherkunft/Referenz
# columns which we skip). See BLS_4_0_Components_DE_EN.xlsx for the codes.
_COL_CODE = 0
_COL_NAME_DE = 1
_COL_NAME_EN = 2
_COL_KCAL = 6      # ENERCC Energie (Kilokalorien) [kcal/100g]
_COL_PROTEIN = 12  # PROT625 Protein (Nx6,25) [g/100g]
_COL_FAT = 15      # FAT Fett [g/100g]
_COL_CARB = 18     # CHO Kohlenhydrate, verfügbar [g/100g]
_COL_FIBER = 21    # FIBT Ballaststoffe, gesamt [g/100g]
_COL_SATFAT = 246  # FASAT Fettsäuren, gesättigt, gesamt [g/100g]
_COL_SUGAR = 219   # SUGAR Zucker (Mono- und Disaccharide) [g/100g]

# Micronutrient columns (E4-S1). Keys mirror IdealProfile.micronutrients
# (services/ideal_profile.py) so borrowed values compare 1:1 with E2 targets
# in E7. Units follow the BLS header (mg or µg) EXCEPT the 4 columns in
# _MICRO_COLS_UG_TO_MG below, which BLS reports in µg but DGE's own
# reference values (services/dge_matcher.py) give in mg -- those are
# converted at extraction time so everything downstream compares like-for-
# like, rather than silently being off by 1000x.
_MICRO_COLS: Dict[str, int] = {
    "vitamin_d_ug": 48,          # VITD    [µg/100g]
    "folate_ug": 105,            # FOL     [µg/100g]
    "vitamin_b12_ug": 114,       # VITB12  [µg/100g]
    "vitamin_c_mg": 117,         # VITC    [mg/100g]
    "sodium_mg": 123,            # NA      [mg/100g]
    "potassium_mg": 129,         # K       [mg/100g]
    "calcium_mg": 132,           # CA      [mg/100g]
    "magnesium_mg": 135,         # MG      [mg/100g]
    "iron_mg": 144,              # FE      [mg/100g]
    "zinc_mg": 147,              # ZN      [mg/100g]
    "iodine_ug": 150,            # ID      [µg/100g]
    "vitamin_a_ug": 36,          # VITAA (Retinol-Aktivitäts-Äquivalent) [µg/100g]
    "vitamin_e_mg": 57,          # VITE (Alpha-Tocopherol) [mg/100g]
    "vitamin_k_ug": 75,          # VITK    [µg/100g]
    "vitamin_b1_mg": 84,         # THIA (Thiamin) [mg/100g]
    "vitamin_b2_mg": 87,         # RIBF (Riboflavin) [mg/100g]
    "niacin_mg": 90,             # NIAEQ (Niacin-Äquivalent) [mg/100g]
    "pantothenic_acid_mg": 96,   # PANTAC  [mg/100g]
    "vitamin_b6_mg": 99,         # VITB6   [µg/100g] -- converted to mg
    "biotin_ug": 102,            # BIOT    [µg/100g]
    "chloride_mg": 126,          # CLD (Chlorid) [mg/100g]
    "phosphorus_mg": 138,        # P (Phosphor) [mg/100g]
    "copper_mg": 153,            # CU (Kupfer) [µg/100g] -- converted to mg
    "manganese_mg": 156,         # MN (Mangan) [µg/100g] -- converted to mg
    "fluoride_mg": 159,          # FD (Fluorid) [µg/100g] -- converted to mg
}
# Sulfur (S, col 141), Chromium (CR, col 162), and Molybdenum (MO, col 165)
# are deliberately not tracked -- dropped per product decision even though
# BLS has real data for them (see git history for the column indices if
# ever revisited).

# BLS reports these in µg, but DGE's reference values (and this app's own
# key suffix) are in mg -- convert once here rather than at every later
# read site.
_MICRO_COLS_UG_TO_MG = {"vitamin_b6_mg", "copper_mg", "manganese_mg", "fluoride_mg"}


class BlsRecord(TypedDict):
    code: str
    name_de: str
    name_en: str
    protein_g: Optional[float]
    fat_g: Optional[float]
    carbs_g: Optional[float]
    saturated_fat_g: Optional[float]
    fiber_g: Optional[float]
    sugar_g: Optional[float]
    calories_kcal: Optional[float]
    micros: Dict[str, float]


def _num(v) -> Optional[float]:
    if v is None or v == "" or isinstance(v, str) and not v.strip():
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _build_cache() -> List[BlsRecord]:
    """Parse the ~7,140-row / 418-column xlsx once and keep only the 7
    columns this matcher needs, cached as compact JSON next to this file
    (mirrors off_api.py's on-disk cache) so every later import is instant
    instead of paying the ~6s full-sheet openpyxl read again."""

    if openpyxl is None:
        raise RuntimeError(
            "openpyxl is required to build the BLS cache (pip install openpyxl); "
            "the committed _bls_cache.json should normally make this unnecessary."
        )
    wb = openpyxl.load_workbook(_XLSX_PATH, read_only=True, data_only=True)
    ws = wb[_SHEET_NAME]
    records: List[BlsRecord] = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        code = row[_COL_CODE]
        name_de = row[_COL_NAME_DE]
        if not code or not name_de:
            continue
        micros = {}
        for key, col in _MICRO_COLS.items():
            val = _num(row[col])
            if val is not None:
                if key in _MICRO_COLS_UG_TO_MG:
                    val = val / 1000.0
                micros[key] = val
        records.append({
            "code": str(code),
            "name_de": str(name_de).strip(),
            "name_en": str(row[_COL_NAME_EN] or "").strip(),
            "protein_g": _num(row[_COL_PROTEIN]),
            "fat_g": _num(row[_COL_FAT]),
            "carbs_g": _num(row[_COL_CARB]),
            "saturated_fat_g": _num(row[_COL_SATFAT]),
            "fiber_g": _num(row[_COL_FIBER]),
            "sugar_g": _num(row[_COL_SUGAR]),
            "calories_kcal": _num(row[_COL_KCAL]),
            "micros": micros,
        })
    wb.close()

    _CACHE_PATH.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
    return records


def _load_records() -> List[BlsRecord]:
    if _CACHE_PATH.exists():
        try:
            return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return _build_cache()


# Loaded once at import time — a static reference table, not a live
# resource (same rationale as recommender.py's RECOMMENDATIONS).
BLS_RECORDS: List[BlsRecord] = _load_records()


def _has_usable_nutrition(rec: BlsRecord) -> bool:
    return any(rec.get(k) is not None for k in ("protein_g", "fiber_g", "sugar_g", "calories_kcal"))


def search_bls(name: str, page_size: int = 5) -> List[dict]:
    """
    Return the top `page_size` BLS candidates for `name`, scored by the
    identical `token_similarity` used for OFF — best of the German name
    and the English name (receipts are German, but a handful of BLS
    entries have a much cleaner English gloss).
    """

    q = (name or "").strip()
    if not q:
        return []

    scored = []
    for rec in BLS_RECORDS:
        score_de = token_similarity(q, rec["name_de"])
        score_en = token_similarity(q, rec["name_en"]) if rec["name_en"] else 0.0
        score = max(score_de, score_en)
        if score <= 0:
            continue
        scored.append((score, rec))

    scored.sort(key=lambda t: -t[0])
    return [{"score": round(s, 3), **rec} for s, rec in scored[:page_size]]


def match_product_bls(name: str, prefer_low_processed: bool = False) -> Optional[dict]:
    """
    Resolve one product name to a BLS entry, mirroring
    `matcher.match_product` tier-for-tier and threshold-for-threshold.

    `prefer_low_processed` is accepted for call-site symmetry with the
    OFF matcher (used when retrying a generalised produce term) but is a
    no-op here: BLS carries no NOVA/processing signal to prefer on.

    Returns None when no candidate clears FUZZY_THRESHOLD with usable
    nutrition — same contract as `matcher.match_product`.
    """

    q = (name or "").strip()
    if not q:
        return None

    candidates = search_bls(q, page_size=10)
    if not candidates:
        return None

    scored = []
    for cand in candidates:
        score = max(
            token_similarity(q, cand["name_de"]),
            token_similarity(q, cand["name_en"]) if cand["name_en"] else 0.0,
        )
        if score < FUZZY_THRESHOLD:
            continue
        if not _has_usable_nutrition(cand):
            continue
        scored.append((score, cand))

    if not scored:
        return None

    scored.sort(key=lambda t: -t[0])
    best_score, best = scored[0]

    is_exact = full_ratio(q, best["name_de"]) >= EXACT_THRESHOLD or full_ratio(q, best["name_en"]) >= EXACT_THRESHOLD

    return {
        "parsed_item_name": q,
        "matched_name": best["name_de"],
        "bls_code": best["code"],
        "match_type": "exact" if is_exact else "fuzzy",
        "confidence": round(best_score, 3),
        "data_source": "BLS",
        "nutrition": {
            "protein_g": best["protein_g"],
            "fiber_g": best["fiber_g"],
            "sugar_g": best["sugar_g"],
            "calories_kcal": best["calories_kcal"],
            "processed_score": None,  # BLS has no NOVA/processing classification
            "micros": best.get("micros", {}),
        },
    }


# ── Helpers for the tiered resolver (E4-S3/S4) ───────────────────────────

# Preparation qualifiers used to spot a "plain" BLS variant (BR-MT3):
# among type-agreeing candidates, one with no prep qualifier (ideally
# "roh") is preferred over "gekocht/gedünstet/gebraten/…".
_PREP_QUALIFIERS = (
    "gekocht", "gedünstet", "geduenstet", "gebraten", "gegrillt", "geröstet",
    "geroestet", "frittiert", "gedämpft", "gedaempft", "blanchiert",
    "getrocknet", "geräuchert", "geraeuchert", "mariniert", "gepökelt",
    "konserviert", "tiefgefroren", "gefroren", "püriert", "pueriert",
    "überbacken", "ueberbacken", "gefüllt", "gefuellt", "paniert", "salat",
    # concentrated / dried forms have very different per-100g density than
    # the plain food, so they must not win the plain-variant pick either.
    "pulver", "getrocknet", "konzentrat", "konzentriert", "extrakt", "granulat",
)


def is_plain_variant(name_de: str) -> bool:
    """True when a BLS name carries no preparation qualifier (BR-MT3)."""

    n = (name_de or "").lower()
    return not any(q in n for q in _PREP_QUALIFIERS)


def prefers_roh(name_de: str) -> bool:
    """True when the BLS name is explicitly the raw ('roh') variant."""

    return "roh" in (name_de or "").lower().split()


def top_records(name: str, limit: int = 10) -> List[BlsRecord]:
    """Return the best-scoring BLS *records* (full nutrition incl. micros)
    for a query, for the whole-food tier and the OFF→BLS bridge. Filtered to
    records that clear FUZZY_THRESHOLD with usable nutrition."""

    q = (name or "").strip()
    if not q:
        return []
    scored = []
    for rec in BLS_RECORDS:
        score = max(
            token_similarity(q, rec["name_de"]),
            token_similarity(q, rec["name_en"]) if rec["name_en"] else 0.0,
        )
        if score < FUZZY_THRESHOLD or not _has_usable_nutrition(rec):
            continue
        scored.append((score, rec))
    scored.sort(key=lambda t: -t[0])
    return [rec for _, rec in scored[:limit]]


def record_nutrition(rec: BlsRecord) -> dict:
    """BLS record → nutrition dict (macros + micros; NOVA stays None here,
    it is always supplied by OFF/category per BR-MT3)."""

    return {
        "protein_g": rec.get("protein_g"),
        "fat_g": rec.get("fat_g"),
        "carbs_g": rec.get("carbs_g"),
        "saturated_fat_g": rec.get("saturated_fat_g"),
        "fiber_g": rec.get("fiber_g"),
        "sugar_g": rec.get("sugar_g"),
        "calories_kcal": rec.get("calories_kcal"),
        "processed_score": None,
        "micros": rec.get("micros", {}),
    }

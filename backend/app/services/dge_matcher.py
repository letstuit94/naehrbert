"""
DGE (Deutsche Gesellschaft für Ernährung) daily micronutrient reference
values, for the Results page's micronutrient targets. Parsed once from
DGE_data/DGE-Referenzwerte.xlsx (the DGE's own published Referenzwerte
table), cached to a JSON sidecar next to this file -- mirrors bls_matcher.py's
cache-once-then-load convention, so a normal run never needs openpyxl.

Every micronutrient services/micronutrients.py tracks *and* that the DGE
sheet actually has a reference value for is extracted, across the 8
population groups the sheet covers: 4 adult age brackets x male/female,
plus the 3 pregnancy trimesters and nursing (all listed under the sheet's
'Weiblich'/female column). There's no under-19 bracket in this workbook --
ages below 19 fall back to the lowest bracket (19 bis unter 25) as the
closest available reference, not because that bracket is actually
validated for a minor.

Simplifications, all because this app doesn't track the extra
distinguishing factor the DGE table itself offers:
  - Eisen (iron) for women 25-65 is given as a compound
    "Prämenopausal 16 Postmenopausal 14" -- the premenopausal (higher,
    more conservative) figure is used, since menopause isn't something
    this app asks about and age alone doesn't reliably determine it.
  - Zink (zinc) is given at three phytate-intake tiers (low/medium/high --
    phytate, common in whole grains/legumes, reduces zinc absorption); the
    medium tier is used as the general-population default.
  - Kupfer/Mangan (copper/manganese) are published as a range
    ("1,0-1,5 mg/Tag") rather than a single value -- DGE's own hedge for
    less precise "Schätzwert" (estimated) data; the midpoint is used as a
    single comparable target number.
"""

import json
import re
from pathlib import Path
from typing import Dict, Optional

try:
    import openpyxl
except ModuleNotFoundError:  # only needed to (re)build the cache, not at runtime
    openpyxl = None

_XLSX_PATH = Path(__file__).resolve().parents[3] / "DGE_data" / "DGE-Referenzwerte.xlsx"
_CACHE_PATH = Path(__file__).parent / "_dge_cache.json"
_SHEET_NAME = "Referenzwerte"

# Our micro key -> the sheet's German "Nährstoff" label. Only covers keys
# in services/micronutrients.py's _MICRO_KEYS -- Sulfur, Chromium, and
# Molybdenum are dropped there entirely, not just omitted here.
_NUTRIENT_MAP = {
    "vitamin_a_ug": "Vitamin A",
    "vitamin_d_ug": "Vitamin D",
    "vitamin_e_mg": "Vitamin E",
    "vitamin_k_ug": "Vitamin K",
    "vitamin_b1_mg": "Thiamin",
    "vitamin_b2_mg": "Riboflavin",
    "niacin_mg": "Niacin",
    "pantothenic_acid_mg": "Pantothensäure",
    "vitamin_b6_mg": "Vitamin B6",
    "biotin_ug": "Biotin",
    "folate_ug": "Folat",
    "vitamin_b12_ug": "Vitamin B12 (Cobalamine)",
    "vitamin_c_mg": "Vitamin C",
    "sodium_mg": "Natrium",
    "chloride_mg": "Chlorid",
    "potassium_mg": "Kalium",
    "calcium_mg": "Calcium",
    "phosphorus_mg": "Phosphor",
    "magnesium_mg": "Magnesium",
    "iron_mg": "Eisen",
    "zinc_mg": "Zink bei mittlerer Phytatzufuhr",
    "copper_mg": "Kupfer",
    "manganese_mg": "Mangan",
    "iodine_ug": "Jod",
    "fluoride_mg": "Fluorid",
}

_PREGNANCY_GROUP = {
    "pregnant_t1": "1. Trimester",
    "pregnant_t2": "2. Trimester",
    "pregnant_t3": "3. Trimester",
    "nursing": "Stillende",
}


def _parse_value(raw) -> Optional[float]:
    """The sheet's 'Referenzwert' column mixes plain numbers, German-comma
    decimals ("4,0"), a compound premenopausal/postmenopausal string, and a
    handful of "low-high" ranges ("1,0-1,5") for less precise trace-mineral
    estimates -- never a silent 0."""

    if isinstance(raw, (int, float)):
        return float(raw)
    if raw is None:
        return None
    text = str(raw).strip()
    premenopausal = re.search(r"Pr[äa]menopausal\s+([\d,.]+)", text)
    if premenopausal:
        text = premenopausal.group(1)
    text = text.replace(",", ".")
    range_match = re.match(r"^([\d.]+)-([\d.]+)$", text)
    if range_match:
        low, high = (float(v) for v in range_match.groups())
        return round((low + high) / 2, 3)
    try:
        return float(text)
    except ValueError:
        return None


def _build_cache() -> Dict[str, Dict[str, float]]:
    """Parse the Referenzwerte sheet once into {"<group>|<sex>": {micro_key: value}},
    cached as JSON next to this file so later imports are instant."""

    if openpyxl is None:
        raise RuntimeError(
            "openpyxl is required to build the DGE cache (pip install openpyxl); "
            "the committed _dge_cache.json should normally make this unnecessary."
        )
    wb = openpyxl.load_workbook(_XLSX_PATH, read_only=True, data_only=True)
    ws = wb[_SHEET_NAME]
    reverse_map = {german: key for key, german in _NUTRIENT_MAP.items()}
    table: Dict[str, Dict[str, float]] = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        group, sex, nutrient = row[0], row[1], row[2]
        micro_key = reverse_map.get(nutrient)
        if micro_key is None or not group or not sex:
            continue
        value = _parse_value(row[3])
        if value is None:
            continue
        table.setdefault(f"{group}|{sex}", {})[micro_key] = value
    wb.close()

    _CACHE_PATH.write_text(json.dumps(table, ensure_ascii=False, indent=2), encoding="utf-8")
    return table


def _load_table() -> Dict[str, Dict[str, float]]:
    if _CACHE_PATH.exists():
        try:
            return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return _build_cache()


# Loaded once at import time -- a static reference table, not a live resource.
_TABLE: Dict[str, Dict[str, float]] = _load_table()


def _age_bracket(age: int) -> str:
    if age < 25:
        return "19 bis unter 25 Jahre"
    if age < 51:
        return "25 bis unter 51 Jahre"
    if age < 65:
        return "51 bis unter 65 Jahre"
    return "65 Jahre und älter"


def get_micronutrient_targets(age: int, sex: str, life_stage: str = "none") -> Optional[Dict[str, float]]:
    """Daily target per micro key for this age/sex/life_stage, or None if
    the lookup can't be resolved (shouldn't happen for a valid age/sex --
    every bracket is present in the sheet).

    Pregnancy/nursing rows are only ever listed under 'Weiblich' in the
    source sheet (they're keyed on the life stage, not the disclosed `sex`
    preference), so a non-NONE life_stage takes priority over age/sex
    regardless of what `sex` was passed. `sex == "prefer_not_to_say"` (with
    life_stage == "none") averages the male/female values, mirroring
    ideal_profile.py's _bmr() convention for the same case."""

    pregnancy_group = _PREGNANCY_GROUP.get(life_stage)
    if pregnancy_group:
        return _TABLE.get(f"{pregnancy_group}|Weiblich")

    bracket = _age_bracket(age)
    if sex == "female":
        return _TABLE.get(f"{bracket}|Weiblich")
    if sex == "male":
        return _TABLE.get(f"{bracket}|Männlich")

    male = _TABLE.get(f"{bracket}|Männlich") or {}
    female = _TABLE.get(f"{bracket}|Weiblich") or {}
    averaged: Dict[str, float] = {}
    for key in set(male) | set(female):
        values = [v for v in (male.get(key), female.get(key)) if v is not None]
        if values:
            averaged[key] = round(sum(values) / len(values), 2)
    return averaged or None

"""
Educational per-nutrient content for the Results page's micronutrient
"Show drivers" expansion, parsed once from the repo-root micronutrients.md
(a plain-language reference covering all 13 vitamins and the major/trace
minerals) -- so that content lives in one place rather than being
duplicated into the frontend.

Only the micronutrients services/micronutrients.py actually tracks (the
ones BLS supplies real purchase data for) are extracted here -- Selenium is
the sole nutrient micronutrients.md covers with no BLS column at all (see
services/bls_matcher.py's _MICRO_COLS), so it has no corresponding purchase
data to show a "drivers from your purchases" section for and is
deliberately left out rather than shown with an always-empty drivers list.
"""

import re
from pathlib import Path
from typing import Dict, List

_MD_PATH = Path(__file__).resolve().parents[3] / "micronutrients.md"

# Our micro key -> the .md file's "### " heading text.
_HEADING_TO_KEY = {
    "Vitamin A (Retinol / Beta-Carotene)": "vitamin_a_ug",
    "Vitamin D": "vitamin_d_ug",
    "Vitamin E": "vitamin_e_mg",
    "Vitamin K": "vitamin_k_ug",
    "Vitamin C": "vitamin_c_mg",
    "Vitamin B1 (Thiamine)": "vitamin_b1_mg",
    "Vitamin B2 (Riboflavin)": "vitamin_b2_mg",
    "Vitamin B3 (Niacin)": "niacin_mg",
    "Vitamin B5 (Pantothenic Acid)": "pantothenic_acid_mg",
    "Vitamin B6 (Pyridoxine)": "vitamin_b6_mg",
    "Vitamin B7 (Biotin)": "biotin_ug",
    "Vitamin B9 (Folate / Folic Acid)": "folate_ug",
    "Vitamin B12 (Cobalamin)": "vitamin_b12_ug",
    "Calcium": "calcium_mg",
    "Phosphorus": "phosphorus_mg",
    "Magnesium": "magnesium_mg",
    "Sodium": "sodium_mg",
    "Potassium": "potassium_mg",
    "Chloride": "chloride_mg",
    "Sulfur": "sulfur_mg",
    "Iron": "iron_mg",
    "Zinc": "zinc_mg",
    "Copper": "copper_mg",
    "Manganese": "manganese_mg",
    "Iodine": "iodine_ug",
    "Fluoride": "fluoride_mg",
    "Chromium": "chromium_ug",
    "Molybdenum": "molybdenum_ug",
}

# Displayed in this order regardless of the .md file's own bullet order.
_SECTION_ORDER = [
    "Why the body needs it",
    "Natural sources",
    "Best ways to consume",
    "Signs of not enough",
    "Signs of too much",
]

_HEADING_RE = re.compile(r"^###\s+(.+)$")
_BULLET_RE = re.compile(r"^-\s+\*\*(.+?):\*\*\s*(.+)$")


def _parse() -> Dict[str, List[Dict[str, str]]]:
    sections_by_key: Dict[str, Dict[str, str]] = {}
    current_key = None

    for line in _MD_PATH.read_text(encoding="utf-8").splitlines():
        heading_match = _HEADING_RE.match(line)
        if heading_match:
            heading = heading_match.group(1).strip()
            current_key = _HEADING_TO_KEY.get(heading)
            if current_key is not None:
                sections_by_key[current_key] = {}
            continue
        if current_key is None:
            continue
        bullet_match = _BULLET_RE.match(line)
        if bullet_match:
            label, body = bullet_match.groups()
            sections_by_key[current_key][label.strip()] = body.strip()

    return {
        key: [
            {"title": title, "body": sections[title]}
            for title in _SECTION_ORDER
            if title in sections
        ]
        for key, sections in sections_by_key.items()
    }


# Loaded once at import time -- a static reference table, not a live resource.
NUTRIENT_INFO: Dict[str, List[Dict[str, str]]] = _parse()

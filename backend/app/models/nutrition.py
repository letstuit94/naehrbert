from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class MatchType(str, Enum):
    """How a receipt item was resolved to nutrition data."""

    LEARNED = "learned"    # Tier-0 verified-match store hit (E5-populated)
    EXACT = "exact"        # high-confidence OpenFoodFacts match
    FUZZY = "fuzzy"        # OpenFoodFacts match via fuzzy name similarity
    BLS = "bls"            # BLS generic whole-food identity (E4-S3)
    FALLBACK = "fallback"  # no match; approximated from a food category
    NONE = "none"          # could not be matched or categorised at all


class NutritionValues(BaseModel):
    """
    Per-100g nutrition for a single product (Task 2.4 / E4).

    All values optional because source data is frequently incomplete;
    downstream code must tolerate missing dimensions. processed_score
    follows the NOVA scale (1 = unprocessed, 4 = ultra).

    `micros` holds the full DGE micronutrient set (E4-S1) keyed exactly
    like IdealProfile.micronutrients (iron_mg, calcium_mg, magnesium_mg,
    zinc_mg, vitamin_c_mg, vitamin_d_ug, vitamin_b12_ug, folate_ug,
    potassium_mg, iodine_ug, sodium_mg) so intake compares 1:1 with E2
    targets in E7. iron_mg/calcium_mg are kept as explicit fields for
    backward compatibility and mirror the same keys in `micros`.

    `sources` records per-value provenance (E4-S5): field name → one of
    "off" | "bls" | "category", so honesty labels know where every number
    came from (NOVA/processed_score is always "off" or "category").
    """

    protein_g: Optional[float] = None
    fat_g: Optional[float] = None
    carbs_g: Optional[float] = None
    saturated_fat_g: Optional[float] = None  # ceiling nutrient (BR-HS2)
    fiber_g: Optional[float] = None
    sugar_g: Optional[float] = None
    calories_kcal: Optional[float] = None
    processed_score: Optional[float] = None
    iron_mg: Optional[float] = None
    calcium_mg: Optional[float] = None
    micros: Dict[str, float] = Field(default_factory=dict)
    sources: Dict[str, str] = Field(default_factory=dict)


class MatchedProduct(BaseModel):
    """
    The `MatchedProduct` contract, produced by the tiered resolver (E4).

    Exactly one of `off_id` / `bls_code` / `fallback_category` is expected
    to be set, except for match_type == NONE where all are null.

    E4-S5 records two confidences: `identity_conf` (how sure we are this is
    the right product) and `nutrition_conf` (how sure we are the nutrition
    numbers are real). `confidence` is retained as the legacy single score
    (= identity_conf) so existing consumers keep working.
    """

    parsed_item_name: str
    matched_name: Optional[str] = None
    off_id: Optional[str] = None
    bls_code: Optional[str] = None
    fallback_category: Optional[str] = None
    brand: Optional[str] = None
    match_type: MatchType
    confidence: float = Field(ge=0.0, le=1.0)
    identity_conf: Optional[float] = None
    nutrition_conf: Optional[float] = None
    unknown: bool = False
    data_source: str
    nutrition: Optional[NutritionValues] = None


class MatchQuality(BaseModel):
    """
    Aggregate match quality for one receipt processing run (Task 2.5).

    match_rate = confident OFF matches / total (the ≥60% target).
    coverage_rate = (matches + fallbacks) / total, i.e. how many items
    ended up usable for the nutrition profile at all.
    """

    total_items: int
    matched_items: int
    fallback_items: int
    failed_items: int
    match_rate: float
    coverage_rate: float


class ReceiptMapping(BaseModel):
    """Full result of mapping one receipt's items to nutrition data."""

    matched_products: List[MatchedProduct]
    match_quality: MatchQuality
    # E4-S6: absolute per-receipt nutrient totals (macros in g / kcal, micros
    # in their native mg/µg), weighted by each item's purchased grams.
    nutrition_totals: Dict[str, float] = Field(default_factory=dict)

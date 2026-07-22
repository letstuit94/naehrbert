"""
Tiered nutrition resolver (Epic 4).

Resolves one receipt item to a `MatchedProduct` through the ordered hybrid
of BR-MT0..MT5:

  Tier 0  learned verified-match lookup            (BR-MT0, inert until E5)
  Tier 1  OpenFoodFacts identity                   (BR-MT1, E4-S2)
          └─ OFF→BLS nutrient bridge under guard    (BR-MT3, E4-S4)
  Tier 1b BLS generic whole-food identity          (BR-MT2, E4-S3)
  Tier 3  category estimate, conf 0.3, "unknown"    (BR-MT4, E4-S5)

Design stance (why the guard is conservative): borrowing BLS nutrition for
the *wrong* food is the single highest-risk failure in the project — a
loose bridge reintroduces BLS's ~33% wrong-food problem. So the bridge only
fires when the BLS candidate shares the OFF product's canonical category
AND its head-noun stem; on any doubt we KEEP OFF's own values (BR-MT3).
NOVA is always taken from OFF/category, never BLS (BR-MT3).

Every value is source-tagged and every item carries two confidences
(identity_conf, nutrition_conf) per BR-MT5. Pure/rule-based; the only I/O
is OFF's own (cached) HTTP layer and the in-memory BLS table.
"""

from typing import Dict, List, Optional

from backend.app.models.nutrition import MatchedProduct, MatchType, NutritionValues
from backend.app.services import base_terms, bls_matcher, matcher, non_food_terms, verified_matches
from backend.app.services.fallback_categories import (
    CATEGORY_NUTRITION,
    FALLBACK_CONFIDENCE,
    _canonical_category,
)

# Generalised (head-noun) matches are less precise than a direct hit.
_GENERIC_CONFIDENCE_CAP = 0.7

# Macro fields borrowed wholesale from BLS in the bridge (NOVA excluded —
# it always stays OFF's).
_MACRO_FIELDS = ("protein_g", "fat_g", "carbs_g", "saturated_fat_g", "fiber_g", "sugar_g", "calories_kcal")

# Per-distinct-product bridge cache (BR-MT7 / E4-S6): the OFF→BLS decision
# is deterministic for a given (off_id, name), so compute it once.
_bridge_cache: Dict[str, Optional[dict]] = {}


def _item_name(item: dict) -> str:
    # receipt_items only ever has `name` (the already-cleaned product name)
    # -- `normalized_name`/`raw_name` were ported fallbacks that no writer
    # in this app has ever populated; keeping them here was misleadingly
    # implying a raw-text path existed for Tier 0 that didn't.
    return (item.get("name") or "").strip()


def _tokens(name: str) -> List[str]:
    import re
    return [t for t in re.findall(r"[a-zäöüß]+", (name or "").lower()) if len(t) >= 4]


def _infl_stem(word: str) -> str:
    """Crude German inflection stem so singular/plural forms unify:
    Tomate/Tomaten → 'tomat', Gurke/Gurken → 'gurk', Apfel → 'apfel'
    (but Apfelsaft stays 'apfelsaft', so a derived product never unifies
    with its base food)."""

    for suf in ("en", "er", "n", "e", "s"):
        if word.endswith(suf) and len(word) - len(suf) >= 3:
            return word[: -len(suf)]
    return word


def _head_stem(name: str) -> Optional[str]:
    """A crude head-noun stem for the type-agreement guard: the longest
    significant token, minus prep qualifiers, stemmed like base_terms."""

    toks = [t for t in _tokens(name) if not any(q in t for q in bls_matcher._PREP_QUALIFIERS)]
    if not toks:
        return None
    head = max(toks, key=len)
    return head[:-1] if head.endswith("e") else head


def _type_agrees(off_name: str, off_category: str, bls_name: str) -> bool:
    """BR-MT3 guard: same canonical category AND head-noun stem agreement.
    Conservative — returns False whenever either signal is missing."""

    if _canonical_category(None, off_name) != _canonical_category(None, bls_name):
        return False
    off_stem, bls_stem = _head_stem(off_name), _head_stem(bls_name)
    if not off_stem or not bls_stem:
        return False
    # containment either way (Gurke ⊂ "Gurke roh"), tolerating inflections.
    return off_stem in bls_name.lower() or bls_stem in off_name.lower()


def _plain_rank(rec: dict) -> tuple:
    """Sort key for picking the plain BLS variant (BR-MT3): prefer the
    explicit 'roh' form, then any form with no prep qualifier, then the
    shortest name (a generic entry over a specific dish)."""

    name = rec["name_de"]
    return (
        0 if bls_matcher.prefers_roh(name) else 1,
        0 if bls_matcher.is_plain_variant(name) else 1,
        len(name),
    )


def _borrow_from_bls(off_name: str, item_name: str, category: Optional[str]) -> Optional[dict]:
    """Find a type-agreeing BLS record and return its record_nutrition, or
    None if no candidate passes the guard (→ keep OFF's own values)."""

    off_cat = _canonical_category(category, off_name or item_name)
    # search on both the OFF name and the item's own generic head noun
    seen, candidates = set(), []
    for query in filter(None, (off_name, item_name, base_terms.generic_term(item_name))):
        for rec in bls_matcher.top_records(query, limit=10):
            if rec["code"] in seen:
                continue
            seen.add(rec["code"])
            if _type_agrees(off_name or item_name, off_cat, rec["name_de"]):
                candidates.append(rec)
    if not candidates:
        return None
    candidates.sort(key=_plain_rank)
    return {"rec": candidates[0], "nutrition": bls_matcher.record_nutrition(candidates[0])}


def _apply_bridge(off_match: MatchedProduct, item_name: str, category: Optional[str]) -> MatchedProduct:
    """E4-S4: overlay BLS macros+micros onto an OFF identity when the guard
    passes; keep NOVA (and any non-borrowed value) from OFF. Cached per
    distinct product (BR-MT7)."""

    key = off_match.off_id or f"name:{(off_match.matched_name or item_name).lower()}"
    if key in _bridge_cache:
        borrowed = _bridge_cache[key]
    else:
        borrowed = _borrow_from_bls(off_match.matched_name or "", item_name, category)
        _bridge_cache[key] = borrowed

    nut = off_match.nutrition or NutritionValues()
    sources = {f: "off" for f in _MACRO_FIELDS if getattr(nut, f) is not None}
    if nut.processed_score is not None:
        sources["processed_score"] = "off"
    # existing OFF micros (sparse) tagged off
    micros = dict(nut.micros)
    for k in micros:
        sources[k] = "off"

    if borrowed is None:
        nut.sources = sources
        off_match.nutrition = nut
        return off_match  # type disagreed → OFF values kept (BR-MT3)

    bnut = borrowed["nutrition"]
    for f in _MACRO_FIELDS:
        if bnut.get(f) is not None:
            setattr(nut, f, bnut[f])
            sources[f] = "bls"
    for k, v in (bnut.get("micros") or {}).items():
        micros[k] = v
        sources[k] = "bls"
    # keep OFF's iron/calcium explicit fields in sync with the micro dict
    if "iron_mg" in micros:
        nut.iron_mg = micros["iron_mg"]
    if "calcium_mg" in micros:
        nut.calcium_mg = micros["calcium_mg"]
    # NOVA stays OFF's — never overwritten from BLS (BR-MT3)
    nut.micros = micros
    nut.sources = sources
    off_match.nutrition = nut
    off_match.bls_code = borrowed["rec"]["code"]
    off_match.data_source = f"OpenFoodFacts + BLS bridge ({borrowed['rec']['name_de']})"
    return off_match


def _bls_whole_food(item_name: str, category: Optional[str]) -> Optional[MatchedProduct]:
    """Tier 1b (BR-MT2 / E4-S3): whole/raw foods only, head-noun agreement."""

    head = base_terms.whole_food_term(item_name)
    if head is None:
        return None  # not a whole food → don't let BLS guess a branded item
    head_stem = _infl_stem(head)

    # Head-noun agreement (BR-MT2): a generic whole-food BLS entry LEADS
    # with the base food ("Tomate roh", "Banane roh"); a dish leads with the
    # dish name and only mentions the produce as a modifier ("Matjes mit
    # Zwiebeln", "Rinderragout mit Paprika"). Requiring the base food to be
    # the FIRST token (inflection-normalized) accepts the former and rejects
    # the latter — and rejects derived products ("Apfelsaft" for "Apfel").
    agreeing = []
    for rec in bls_matcher.BLS_RECORDS:
        toks = _tokens(rec["name_de"])
        if toks and _infl_stem(toks[0]) == head_stem and bls_matcher._has_usable_nutrition(rec):
            agreeing.append(rec)
    if not agreeing:
        return None

    # Among head-agreeing candidates prefer the plain/raw generic ("Spinat
    # roh") over a compound dish that merely contains the word ("… Spinat"):
    # same plain-variant rule as the bridge (BR-MT3).
    agreeing.sort(key=_plain_rank)
    rec = agreeing[0]
    bnut = bls_matcher.record_nutrition(rec)
    sources = {f: "bls" for f in _MACRO_FIELDS if bnut.get(f) is not None}
    sources.update({k: "bls" for k in bnut.get("micros", {})})
    return MatchedProduct(
        parsed_item_name=item_name,
        matched_name=rec["name_de"],
        bls_code=rec["code"],
        match_type=MatchType.BLS,
        confidence=0.7,
        identity_conf=0.7,
        nutrition_conf=1.0,
        data_source="BLS (whole food)",
        nutrition=NutritionValues(
            protein_g=bnut["protein_g"], fat_g=bnut.get("fat_g"), carbs_g=bnut.get("carbs_g"),
            saturated_fat_g=bnut.get("saturated_fat_g"), fiber_g=bnut["fiber_g"],
            sugar_g=bnut["sugar_g"], calories_kcal=bnut["calories_kcal"],
            processed_score=None,  # NOVA absent for BLS-only (BR-G6 handles it)
            iron_mg=bnut["micros"].get("iron_mg"),
            calcium_mg=bnut["micros"].get("calcium_mg"),
            micros=bnut["micros"], sources=sources,
        ),
    )


def _category_fallback(item_name: str, category: Optional[str]) -> MatchedProduct:
    """Tier 3 (BR-MT4 / E4-S5): category estimate, conf 0.3, flagged unknown."""

    canonical = _canonical_category(category, item_name)
    base = CATEGORY_NUTRITION.get(canonical, CATEGORY_NUTRITION["other"])
    nut = base.model_copy(deep=True)
    sources = {f: "category" for f in _MACRO_FIELDS if getattr(nut, f) is not None}
    if nut.processed_score is not None:
        sources["processed_score"] = "category"
    for k in ("iron_mg", "calcium_mg"):
        if getattr(nut, k) is not None:
            sources[k] = "category"
    nut.sources = sources
    return MatchedProduct(
        parsed_item_name=item_name,
        matched_name=None,
        fallback_category=canonical,
        match_type=MatchType.FALLBACK,
        confidence=FALLBACK_CONFIDENCE,
        identity_conf=FALLBACK_CONFIDENCE,
        nutrition_conf=FALLBACK_CONFIDENCE,
        unknown=True,
        data_source=f"fallback_category:{canonical}",
        nutrition=nut,
    )


def _learned(name: str) -> Optional[MatchedProduct]:
    """Tier 0 (BR-MT0): verified-match hit by product name, any store → conf 1.0."""

    hit = verified_matches.lookup_verified_match(name)
    if not hit:
        return None
    nut = NutritionValues(**hit["nutrition"]) if hit.get("nutrition") else None
    conf = float(hit.get("confidence", 1.0))
    return MatchedProduct(
        parsed_item_name=name,
        matched_name=hit.get("matched_name"),
        off_id=hit.get("off_id"),
        bls_code=hit.get("bls_code"),
        match_type=MatchType.LEARNED,
        confidence=conf,
        identity_conf=conf,
        nutrition_conf=1.0,
        data_source="verified match",
        nutrition=nut,
    )


def resolve_item(item: dict) -> MatchedProduct:
    """Resolve one receipt-item dict to a MatchedProduct via the ordered
    tiers. Never raises: an unmatched item degrades to the category
    estimate rather than erroring (BR-MT: matching never blocks)."""

    name = _item_name(item)
    category = item.get("category")

    # E3-S4 follow-up: an item the user (or the learned keyword list)
    # marked non-food is deliberately never matched — no OFF/BLS lookup,
    # no category-fallback nutrition. nutrition=None is the same "nothing
    # to add" signal every downstream consumer (status_quo, gap_engine,
    # health_score, next_cart) already skips for missing-data items, so
    # this is a single choke point rather than a filter every caller has
    # to remember to apply.
    if non_food_terms.is_non_food_category(category):
        return MatchedProduct(
            parsed_item_name=name, match_type=MatchType.NONE, confidence=0.0,
            identity_conf=0.0, nutrition_conf=0.0, data_source="non_food", nutrition=None,
        )

    if not name:
        return MatchedProduct(
            parsed_item_name="", match_type=MatchType.NONE, confidence=0.0,
            identity_conf=0.0, nutrition_conf=0.0, data_source="none", nutrition=None,
        )

    # Tier 0 — learned verified match (inert until E5)
    learned = _learned(name)
    if learned is not None:
        return learned

    # Tier 1 — OFF identity (full name, then generic head noun), + bridge
    off_match = matcher.match_product(name)
    if off_match is None:
        generic = base_terms.generic_term(name)
        if generic:
            gm = matcher.match_product(generic, prefer_low_processed=True)
            if gm is not None:
                gm.parsed_item_name = name
                gm.match_type = MatchType.FUZZY
                gm.confidence = round(min(gm.confidence, _GENERIC_CONFIDENCE_CAP), 3)
                gm.identity_conf = gm.confidence
                gm.data_source = f"OpenFoodFacts (generic: {generic})"
                off_match = gm
    if off_match is not None:
        return _apply_bridge(off_match, name, category)

    # Tier 1b — BLS whole-food identity (produce OFF missed)
    bls_match = _bls_whole_food(name, category)
    if bls_match is not None:
        return bls_match

    # Tier 3 — category estimate (unknown)
    return _category_fallback(name, category)

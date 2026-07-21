"""
Generic base-term derivation for produce (Epic 2 matching improvement).

German grocery names are often specific compounds ("Rispentomaten",
"Plattpfirsiche") that OpenFoodFacts fails to match directly. Before
falling back to a broad food category, we reduce such a name to its
head noun ("Tomate", "Pfirsich") and retry the OFF lookup, which keeps
us much closer to the item's real nutrition.

German compounds put the head noun LAST, so when several base words
appear in one name we pick the RIGHTMOST one — this is what stops
"Erdbeerjoghurt" from being generalised to a strawberry (fruit) instead
of yoghurt: "joghurt" sits to the right of "erdbeer".
"""

from typing import Optional

# Canonical base foods (singular). Kept produce-focused because that is
# where specific-compound naming hurts matching most. Easy to extend:
# just add the singular form here.
_BASE_FOODS = [
    # fruits
    "apfel", "banane", "birne", "pfirsich", "nektarine", "aprikose",
    "pflaume", "kirsche", "erdbeere", "himbeere", "heidelbeere",
    "blaubeere", "brombeere", "traube", "weintraube", "orange",
    "mandarine", "clementine", "zitrone", "limette", "melone",
    "wassermelone", "ananas", "mango", "kiwi", "feige", "granatapfel",
    "avocado",
    # vegetables
    "tomate", "gurke", "paprika", "zwiebel", "knoblauch", "kartoffel",
    "möhre", "karotte", "zucchini", "aubergine", "brokkoli",
    "blumenkohl", "rotkohl", "kohl", "spinat", "salat", "kopfsalat",
    "rucola", "lauch", "sellerie", "rettich", "radieschen", "kürbis",
    "bohne", "erbse", "mais", "spargel", "champignon", "pilz", "ingwer",
    "bete",
]


def _stem(word: str) -> str:
    """A crude stem so plurals/compounds still match (tomate -> tomat)."""

    return word[:-1] if word.endswith("e") else word


# (stem, canonical) pairs.
_STEMS = [(_stem(food), food) for food in _BASE_FOODS]

# Max characters allowed after the stem for it to count as the compound
# head: covers German plural/inflection endings ("-n", "-e", "-en",
# "-er", "-che"). This is what enforces "the base word is the suffix".
_MAX_TAIL = 3


def generic_term(name: str) -> Optional[str]:
    """
    Return the canonical head-noun base term for a product name, or None.

    A base word only qualifies when it forms the *tail* of the name (the
    German compound head), so "Rispentomaten" -> "Tomate" but
    "Erdbeerjoghurt" -> None (the head "joghurt" is not a produce word,
    and "erdbeer" is not the tail). When two base words end at the same
    position the longer one wins, so "Granatapfel" resolves to itself
    (-> None) rather than to "Apfel".
    """

    name_l = (name or "").strip().lower()
    if not name_l:
        return None

    best_canonical = None
    best_pos = -1
    best_end = -1
    best_len = -1
    for stem, canonical in _STEMS:
        pos = name_l.rfind(stem)
        if pos < 0:
            continue
        end = pos + len(stem)
        tail = len(name_l) - end
        if tail > _MAX_TAIL:
            continue  # base word is not the compound head -> ignore
        # Prefer the match ending furthest right; break ties by longer stem.
        if end > best_end or (end == best_end and len(stem) > best_len):
            best_pos = pos
            best_end = end
            best_len = len(stem)
            best_canonical = canonical

    if best_canonical is None:
        return None

    # Base word starts at position 0 -> the name is just the base term
    # itself, inflected ("Kartoffeln", "Tomaten"), not a compound like
    # "Rispentomaten". Retrying the singular wouldn't add anything.
    if best_pos == 0:
        return None

    return best_canonical


def whole_food_term(name: str) -> Optional[str]:
    """
    Like `generic_term`, but also returns the canonical base food when the
    name *is* the base term itself ("Banane", "Tomaten") — not only for
    compounds. Used by the BLS whole-food tier (E4-S3) to decide whether an
    item is a whole/raw food at all and, if so, its head noun for the
    head-noun-agreement gate. Returns None for non-produce (e.g. yoghurt).
    """

    name_l = (name or "").strip().lower()
    if not name_l:
        return None

    best_canonical = None
    best_end = -1
    best_len = -1
    for stem, canonical in _STEMS:
        pos = name_l.rfind(stem)
        if pos < 0:
            continue
        end = pos + len(stem)
        if len(name_l) - end > _MAX_TAIL:
            continue
        if end > best_end or (end == best_end and len(stem) > best_len):
            best_end = end
            best_len = len(stem)
            best_canonical = canonical

    return best_canonical

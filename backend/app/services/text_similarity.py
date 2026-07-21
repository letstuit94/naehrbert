"""
Shared fuzzy text-similarity helper.

Extracted from Task 2.2's product matcher (originally a private
`_similarity` in matcher.py) so Task 8.6/8.8's receipt comparison uses
the identical, already-proven logic instead of a naively weaker one.

A raw whole-string SequenceMatcher ratio badly under-scores a short
query against a longer/differently-worded name — "Linsen" vs "Rote
Linsen" scores ~0.71, "Eier" vs "Bio Eier" ~0.67, both well below any
reasonable match threshold, even though a human would call these the
same product. Taking the best of the whole-string ratio and a
token-level containment score fixes that.
"""

import re
from difflib import SequenceMatcher

# Score for a token that is contained in the other name (e.g. "joghurt"
# inside "naturjoghurt"): high, but capped below a typical "exact match"
# threshold so a containment match is honestly labelled "fuzzy".
CONTAINMENT_SCORE = 0.85

_TOKEN_RE = re.compile(r"[a-zäöüß0-9]+")

# Qualifier/conjunction words common across many unrelated German food
# names (raw/cooking-state descriptors, prepositions). Bug found while
# cross-checking fallback_categories.py's nutrition table against BLS:
# querying "Spinat roh" scored a false 1.0 against "Hafer ganzes Korn,
# roh" — completely different foods — because both names contain the
# token "roh", and at 3 characters it's too short for the containment
# check below (which requires len >= 4), so it fell through to the plain
# SequenceMatcher branch, where "roh" vs "roh" is trivially a perfect
# ratio. Excluding these from token-level comparison stops a shared
# qualifier word from single-handedly forcing a high score; the
# whole-string ratio above is computed on the original strings and is
# unaffected.
_STOPWORDS = {"roh", "mit", "und", "aus", "ohne", "der", "die", "das", "im", "vom", "von"}


def _tokens(s: str) -> list:
    return [t for t in _TOKEN_RE.findall(s.lower()) if len(t) >= 3 and t not in _STOPWORDS]


def full_ratio(query: str, candidate: str) -> float:
    """
    Plain whole-string SequenceMatcher ratio (0..1), case-insensitive.

    Unlike token_similarity this does NOT reward token containment, so it
    is the stricter metric the acceptance criteria use to gate the "exact"
    label (BR-MT1 / E4-S2: exact only when the whole-string ratio ≥ 0.90).
    """

    q = (query or "").strip().lower()
    c = (candidate or "").strip().lower()
    if not q or not c:
        return 0.0
    return SequenceMatcher(None, q, c).ratio()


def token_similarity(query: str, candidate: str) -> float:
    """
    Similarity between two names (0..1). Takes the best of a full-string
    ratio and a token-level score, so a short query still scores high
    against a longer, differently-worded name ("Gouda" vs "Queso Gouda",
    "Rote Linsen" vs "Linsen").
    """

    q = (query or "").strip().lower()
    c = (candidate or "").strip().lower()
    if not q or not c:
        return 0.0

    best = SequenceMatcher(None, q, c).ratio()

    q_tokens = _tokens(q)
    c_tokens = _tokens(c)
    for qt in q_tokens:
        for ct in c_tokens:
            if len(qt) >= 4 and (qt in ct or ct in qt):
                best = max(best, CONTAINMENT_SCORE)
            else:
                best = max(best, SequenceMatcher(None, qt, ct).ratio())

    return best

from backend.app.services.text_similarity import full_ratio, token_similarity


def test_token_similarity_rewards_containment_over_full_ratio():
    # Docstring's own worked examples: a short query against a longer name
    # scores far higher under token_similarity than a naive full_ratio.
    assert full_ratio("Linsen", "Rote Linsen") < 0.8
    assert token_similarity("Linsen", "Rote Linsen") >= full_ratio("Linsen", "Rote Linsen")
    assert token_similarity("Eier", "Bio Eier") > 0.8


def test_identical_strings_score_1():
    assert full_ratio("Gouda", "Gouda") == 1.0
    assert token_similarity("Gouda", "Gouda") == 1.0


def test_empty_strings_score_0():
    assert full_ratio("", "Gouda") == 0.0
    assert token_similarity("Gouda", "") == 0.0


def test_shared_qualifier_word_does_not_force_a_false_match():
    """Regression test: "roh" (raw) is a 3-char token shared by nearly
    every BLS whole-food entry — too short for the containment check
    (len >= 4), so it used to fall through to a plain SequenceMatcher
    comparison where "roh" vs "roh" is a trivial perfect ratio, making
    completely unrelated foods that both happen to say "roh" score 1.0.
    Found while cross-checking fallback_categories.py against the real
    BLS database — "Spinat roh" matched "Hafer ganzes Korn, roh" (oats)
    at a perfect score."""

    unrelated_score = token_similarity("Spinat roh", "Hafer ganzes Korn, roh")
    assert unrelated_score < 0.5
    # A real match on the same qualifier word must still score perfectly.
    assert token_similarity("Spinat roh", "Spinat roh") == 1.0

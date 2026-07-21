from backend.app.services.base_terms import generic_term, whole_food_term


def test_generic_term_reduces_compound_to_head_noun():
    # Docstring's own worked examples for the German-compound head-noun rule.
    assert generic_term("Rispentomaten") == "tomate"
    assert generic_term("Erdbeerjoghurt") is None  # head is "joghurt", not produce


def test_generic_term_returns_none_for_the_base_word_itself():
    assert generic_term("Kartoffeln") is None
    assert generic_term("Tomaten") is None


def test_whole_food_term_accepts_the_base_word_itself():
    assert whole_food_term("Banane") == "banane"
    assert whole_food_term("Tomaten") == "tomate"
    assert whole_food_term("Naturjoghurt") is None  # not produce

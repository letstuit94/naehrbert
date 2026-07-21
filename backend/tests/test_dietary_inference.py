from backend.app.models.profile import DietaryStyle
from backend.app.services.dietary_inference import infer_dietary_style


def _item(category, is_non_food=False):
    return {"category": category, "is_non_food": is_non_food}


def test_meat_present_is_omnivore_even_with_everything_else():
    items = [
        _item("lean_poultry"),
        _item("white_fish"),
        _item("eggs"),
        _item("whole_grains"),
    ]
    assert infer_dietary_style(items) == DietaryStyle.OMNIVORE


def test_fish_without_meat_is_pescatarian():
    items = [_item("fatty_fish"), _item("full_fat_dairy"), _item("whole_grains")]
    assert infer_dietary_style(items) == DietaryStyle.PESCATARIAN


def test_dairy_or_eggs_without_meat_or_fish_is_vegetarian():
    assert infer_dietary_style([_item("eggs"), _item("whole_grains")]) == DietaryStyle.VEGETARIAN
    assert infer_dietary_style([_item("hard_and_semi_hard_cheese")]) == DietaryStyle.VEGETARIAN


def test_no_animal_products_at_all_is_vegan():
    items = [_item("whole_grains"), _item("tofu"), _item("citrus_fruits")]
    assert infer_dietary_style(items) == DietaryStyle.VEGAN


def test_empty_basket_defaults_to_vegan():
    assert infer_dietary_style([]) == DietaryStyle.VEGAN


def test_non_food_items_are_ignored():
    items = [_item("lean_poultry", is_non_food=True), _item("whole_grains")]
    assert infer_dietary_style(items) == DietaryStyle.VEGAN

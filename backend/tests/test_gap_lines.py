"""
Tests for services/gap_lines.py -- the plain-language gap descriptions
shared by recipe generation and the Insights page's gap-closing
recommendations.
"""

from backend.app.services.gap_lines import macro_gap_lines, micronutrient_gap_lines

_GAP = {
    "actual_pct": {"protein": 12.0, "fat": 40.0, "carb": 48.0},
    "target_pct": {"protein_pct": 25.0, "fat_pct": 30.0, "carb_pct": 45.0},
    "delta_pct": {"protein": -13.0, "fat": 10.0, "carb": 3.0},
}


def test_macro_gap_lines_flags_under_and_over_target():
    lines = macro_gap_lines(_GAP)
    protein_line = next(l for l in lines if "protein" in l)
    fat_line = next(l for l in lines if "fat" in l)
    assert "UNDER target" in protein_line
    assert "OVER target" in fat_line


def test_macro_gap_lines_treats_small_deltas_as_close():
    gap = {
        "actual_pct": {"protein": 24.0, "fat": 30.0, "carb": 46.0},
        "target_pct": {"protein_pct": 25.0, "fat_pct": 30.0, "carb_pct": 45.0},
        "delta_pct": {"protein": -1.0, "fat": 0.0, "carb": 1.0},
    }
    lines = macro_gap_lines(gap)
    assert all("already close" in l for l in lines)


def test_macro_gap_lines_skips_macros_with_missing_data():
    gap = {"actual_pct": {}, "target_pct": {}, "delta_pct": {}}
    assert macro_gap_lines(gap) == []


def test_micronutrient_gap_lines_flags_only_significant_shortfalls():
    totals = {"iron_mg": 2.0, "vitamin_c_mg": 90.0}
    targets = {"iron_mg": 20.0, "vitamin_c_mg": 95.0}
    # iron: 2/28 = 0.0714/day vs target 20 -> ~0.4% coverage -- flagged
    # vitamin_c: 90/28 = 3.2/day vs target 95 -- also low here, but the
    # point of this test is just that iron (far worse) is present.
    lines = micronutrient_gap_lines(totals, targets, days_of_data=28)
    assert any("Iron" in l for l in lines)


def test_micronutrient_gap_lines_skips_nutrients_at_or_above_the_floor():
    totals = {"vitamin_c_mg": 2800.0}  # 100/day
    targets = {"vitamin_c_mg": 100.0}  # exactly at target -- 100% coverage
    assert micronutrient_gap_lines(totals, targets, days_of_data=28) == []


def test_micronutrient_gap_lines_handles_missing_targets():
    assert micronutrient_gap_lines({"iron_mg": 2.0}, None, days_of_data=28) == []
    assert micronutrient_gap_lines({"iron_mg": 2.0}, {}, days_of_data=28) == []


def test_micronutrient_gap_lines_handles_zero_days_of_data():
    assert micronutrient_gap_lines({"iron_mg": 2.0}, {"iron_mg": 20.0}, days_of_data=0) == []


def test_micronutrient_gap_lines_never_flags_vitamin_d_iodine_or_fluoride():
    """Product decision: these three are never worth surfacing as a
    recommendation, no matter how low the coverage."""

    totals = {"vitamin_d_ug": 0.0, "iodine_ug": 0.0, "fluoride_mg": 0.0}
    targets = {"vitamin_d_ug": 20.0, "iodine_ug": 200.0, "fluoride_mg": 3.5}
    assert micronutrient_gap_lines(totals, targets, days_of_data=28) == []


def test_micronutrient_gap_lines_never_flags_low_sodium():
    totals = {"sodium_mg": 0.0}  # 0% coverage -- would trip the usual floor
    targets = {"sodium_mg": 1500.0}
    assert micronutrient_gap_lines(totals, targets, days_of_data=28) == []


def test_micronutrient_gap_lines_flags_high_sodium():
    totals = {"sodium_mg": 1500.0 * 28 * 2}  # 200% of target every day
    targets = {"sodium_mg": 1500.0}
    lines = micronutrient_gap_lines(totals, targets, days_of_data=28)
    assert len(lines) == 1
    assert "too high" in lines[0]


def test_micronutrient_gap_lines_does_not_flag_sodium_just_over_target():
    totals = {"sodium_mg": 1500.0 * 28 * 1.2}  # 120% of target -- not over the ceiling yet
    targets = {"sodium_mg": 1500.0}
    assert micronutrient_gap_lines(totals, targets, days_of_data=28) == []

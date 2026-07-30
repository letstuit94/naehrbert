"""
Gap-closing recommendation schema — the Insights page's "recommendations"
section, generated from the macro gap (get_target_comparison) and
micronutrient gap (get_micronutrients), respecting the profile's dietary
style/allergies/dislikes.

`GapRecommendations` is used directly as Groq's structured-output
response_format schema (services/groq_client.py's
generate_gap_recommendations), same convention as models/recipe.py's
`RecipeSuggestion` -- `extra="forbid"` isn't just validation strictness,
it's what makes pydantic emit the `additionalProperties: false` Groq's
strict json_schema mode requires on every object in the schema.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict


class GapRecommendationItem(BaseModel):
    """One focused suggestion. `focus` is a short label naming which gap
    this addresses (e.g. "protein", "vitamin_d_ug") -- not shown to the
    model as a fixed enum, since the gap could be any macro or any of the
    25 tracked micronutrients; the model just echoes back whichever one(s)
    it's actually addressing."""

    model_config = ConfigDict(extra="forbid")

    focus: str
    suggestion: str


class GapRecommendations(BaseModel):
    """The exact shape the model is forced to return (response_format)."""

    model_config = ConfigDict(extra="forbid")

    summary: str
    items: List[GapRecommendationItem]


class GapRecommendationsResponse(GapRecommendations):
    """One persisted recommendation, as stored in the `gap_recommendations`
    table -- up to DAILY_GENERATION_LIMIT (api/recommendations.py) of these
    accumulate per profile per (UTC) day, each only ever created by an
    explicit user action, never auto-generated."""

    model_config = ConfigDict(extra="ignore")

    id: Optional[str] = None
    created_at: Optional[datetime] = None

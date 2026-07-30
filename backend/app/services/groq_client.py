"""
Groq client wrapper (recipe-recommendations feature + the Insights page's
gap-closing recommendations).

Uses Groq's OpenAI-compatible structured-outputs mode (`response_format`
type `json_schema`, `strict: true`): the schema passed for each call is
one of `RecipeSuggestion`/`GapRecommendations`/`DietaryLabelClassification`'s
own `model_json_schema()`, so the model is forced to return exactly that
shape rather than free text we'd have to parse and hope is valid JSON.
This doesn't make the *values* correct -- the model's calorie/macro
estimate is still an estimate (see models/recipe.py's docstring for why
that's the deliberate design here) -- but it does rule out an entire
class of "hallucinated" failure: malformed output, missing fields, or
prose wrapped around the JSON. Verified live against the real API (nested
objects included) before relying on it here -- Groq's strict mode
requires every object in the schema to declare `additionalProperties:
false`, which is exactly what each schema's `extra="forbid"` config makes
pydantic emit automatically.

Strict-mode structured outputs are currently only supported by Groq's
`openai/gpt-oss-20b`/`openai/gpt-oss-120b` models (see get_settings().groq_model).

The client is built lazily per call (not memoized like db/supabase.py's
get_client()) since GROQ_API_KEY is optional and may be unset for most of
this app's lifetime -- constructing it eagerly would mean any import of
this module needs a key, the same anti-pattern db/supabase.py's docstring
already calls out for the Supabase client.
"""

from typing import List

from groq import Groq

from backend.app.core.config import get_settings
from backend.app.models.profile import DietaryStyle
from backend.app.models.recipe import DietaryLabelClassification, RecipeSuggestion
from backend.app.models.recommendation import GapRecommendations


class GroqNotConfigured(RuntimeError):
    """Raised when GROQ_API_KEY isn't set -- callers turn this into a
    503 rather than letting the app crash at import/startup time."""


def _client() -> Groq:
    settings = get_settings()
    if not settings.groq_api_key:
        raise GroqNotConfigured(
            "GROQ_API_KEY is not set -- recipe generation isn't configured yet."
        )
    # A few retries with the SDK's own backoff before giving up -- Groq,
    # like any hosted inference API, can return a transient 429/5xx that a
    # short retry would very likely clear on its own.
    return Groq(api_key=settings.groq_api_key, max_retries=3)


def generate_recipe_suggestion(prompt: str, temperature: float = 0.6) -> RecipeSuggestion:
    settings = get_settings()
    response = _client().chat.completions.create(
        model=settings.groq_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "recipe_suggestion",
                "strict": True,
                "schema": RecipeSuggestion.model_json_schema(),
            },
        },
    )
    content = response.choices[0].message.content
    if not content:
        # Structured-output mode failed to produce anything (e.g. the
        # model refused, or hit a content filter) -- surface plainly
        # rather than silently returning something malformed.
        raise ValueError("Groq did not return a recipe suggestion.")
    try:
        return RecipeSuggestion.model_validate_json(content)
    except ValueError as exc:
        raise ValueError(f"Groq returned a recipe suggestion that failed validation: {exc}") from exc


def generate_gap_recommendations(prompt: str, temperature: float = 0.4) -> GapRecommendations:
    settings = get_settings()
    response = _client().chat.completions.create(
        model=settings.groq_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "gap_recommendations",
                "strict": True,
                "schema": GapRecommendations.model_json_schema(),
            },
        },
    )
    content = response.choices[0].message.content
    if not content:
        raise ValueError("Groq did not return gap recommendations.")
    try:
        return GapRecommendations.model_validate_json(content)
    except ValueError as exc:
        raise ValueError(f"Groq returned gap recommendations that failed validation: {exc}") from exc


def classify_dietary_label(ingredient_names: List[str]) -> DietaryStyle:
    """Classifies an EXISTING recipe's dietary label from its ingredient
    list alone -- the one-off backfill script's use of this (recipes
    generated before RecipeSuggestion.dietary_label existed) is the only
    caller; a newly generated recipe gets its label directly from
    generate_recipe_suggestion instead of a second call like this one."""

    prompt = f"""Classify this recipe's dietary category based ONLY on its
ingredient list below -- not any dietary intent, just what's literally in it.

Ingredients:
{chr(10).join(f"- {name}" for name in ingredient_names)}

Return exactly one dietary_label, the most specific/restrictive one that's
still true for these exact ingredients:
- "vegan": zero animal-derived ingredients (no meat, poultry, fish,
  seafood, dairy, eggs, or honey/gelatin/etc.).
- "vegetarian": no meat, poultry, fish, or seafood, but dairy and/or eggs
  are present.
- "pescatarian": contains fish or seafood, but no meat or poultry.
- "omnivore": contains meat or poultry.
"""

    settings = get_settings()
    response = _client().chat.completions.create(
        model=settings.groq_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,  # a factual classification, not creative -- no variety wanted
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "dietary_label_classification",
                "strict": True,
                "schema": DietaryLabelClassification.model_json_schema(),
            },
        },
    )
    content = response.choices[0].message.content
    if not content:
        raise ValueError("Groq did not return a dietary label classification.")
    return DietaryLabelClassification.model_validate_json(content).dietary_label

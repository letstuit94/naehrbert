"""
Gemini client wrapper (recipe-recommendations feature).

Uses the `google-genai` SDK's structured-output mode: `response_schema` is
`GeminiRecipeSuggestion` itself, so Gemini is forced to return exactly that
shape (title/ingredients/steps/time/nutrition, all required fields present
and correctly typed) rather than free text we'd have to parse and hope is
valid JSON. This doesn't make the *values* correct -- Gemini's calorie/
macro estimate is still an estimate (see models/recipe.py's docstring for
why that's the deliberate design here) -- but it does rule out an entire
class of "hallucinated" failure: malformed output, missing fields, or
prose wrapped around the JSON.

The client is built lazily per call (not memoized like db/supabase.py's
get_client()) since GEMINI_API_KEY is optional and may be unset for most
of this app's lifetime -- constructing it eagerly would mean any import of
this module needs a key, the same anti-pattern db/supabase.py's docstring
already calls out for the Supabase client.
"""

from typing import List

from google import genai
from google.genai import types

from backend.app.core.config import get_settings
from backend.app.models.profile import DietaryStyle
from backend.app.models.recipe import DietaryLabelClassification, GeminiRecipeSuggestion


class GeminiNotConfigured(RuntimeError):
    """Raised when GEMINI_API_KEY isn't set -- callers turn this into a
    503 rather than letting the app crash at import/startup time."""


def generate_recipe_suggestion(prompt: str, temperature: float = 0.6) -> GeminiRecipeSuggestion:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise GeminiNotConfigured(
            "GEMINI_API_KEY is not set -- recipe generation isn't configured yet."
        )

    client = genai.Client(api_key=settings.gemini_api_key)
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=GeminiRecipeSuggestion,
            temperature=temperature,
            # The SDK makes exactly ONE attempt by default (no retry_options
            # -> tenacity.stop_after_attempt(1)) -- confirmed live against
            # the real API that Gemini can return a transient 503 ("high
            # demand... try again later") that a short retry would very
            # likely clear on its own. Keep this bounded (short backoff,
            # only a couple of retries) so a genuinely down model still
            # fails within a few seconds rather than leaving the user
            # waiting a long time before the chat can show an error.
            http_options=types.HttpOptions(
                retry_options=types.HttpRetryOptions(
                    attempts=3, initial_delay=1.0, max_delay=6.0
                )
            ),
        ),
    )
    if not isinstance(response.parsed, GeminiRecipeSuggestion):
        # Structured-output mode failed to produce a valid instance (e.g.
        # the model refused, or hit a safety block) -- surface plainly
        # rather than silently returning something malformed.
        raise ValueError("Gemini did not return a valid recipe suggestion.")
    return response.parsed


def classify_dietary_label(ingredient_names: List[str]) -> DietaryStyle:
    """Classifies an EXISTING recipe's dietary label from its ingredient
    list alone -- the one-off backfill script's use of this (recipes
    generated before GeminiRecipeSuggestion.dietary_label existed) is the
    only caller; a newly generated recipe gets its label directly from
    generate_recipe_suggestion instead of a second call like this one."""

    settings = get_settings()
    if not settings.gemini_api_key:
        raise GeminiNotConfigured(
            "GEMINI_API_KEY is not set -- recipe generation isn't configured yet."
        )

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

    client = genai.Client(api_key=settings.gemini_api_key)
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=DietaryLabelClassification,
            temperature=0.0,  # a factual classification, not creative -- no variety wanted
            http_options=types.HttpOptions(
                retry_options=types.HttpRetryOptions(
                    attempts=3, initial_delay=1.0, max_delay=6.0
                )
            ),
        ),
    )
    if not isinstance(response.parsed, DietaryLabelClassification):
        raise ValueError("Gemini did not return a valid dietary label classification.")
    return response.parsed.dietary_label

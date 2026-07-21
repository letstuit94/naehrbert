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

from google import genai
from google.genai import types

from backend.app.core.config import get_settings
from backend.app.models.recipe import GeminiRecipeSuggestion


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
        ),
    )
    if not isinstance(response.parsed, GeminiRecipeSuggestion):
        # Structured-output mode failed to produce a valid instance (e.g.
        # the model refused, or hit a safety block) -- surface plainly
        # rather than silently returning something malformed.
        raise ValueError("Gemini did not return a valid recipe suggestion.")
    return response.parsed

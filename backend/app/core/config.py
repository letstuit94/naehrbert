"""
Application settings (Epic 0.1). Simplified vs. the old repo's config:
no SUPABASE_JWT_SECRET (no auth), no COACH_LLM_ENABLED (no coach feature).
"""

from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_service_role_key: str
    allowed_origins: str = "http://localhost:5173"

    # Recipe recommendations feature — optional (not required) so a missing
    # key only disables POST /recipes/generate rather than crashing the
    # whole app at Settings() construction time (every other route still
    # needs to work with no Gemini key configured).
    gemini_api_key: Optional[str] = None
    gemini_model: str = "gemini-2.5-flash"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

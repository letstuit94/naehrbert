"""
Supabase client factory (Epic 0.1). The client is built lazily and
memoized, rather than at module import time — the old repo's db/supabase.py
called `create_client()` at import time, which meant any module importing
it (even transitively) failed without SUPABASE_URL/SUPABASE_KEY set. Every
caller here goes through `get_client()`, so importing this module never
requires credentials — only calling it does.
"""

from functools import lru_cache

from backend.app.core.config import get_settings
from supabase import Client, create_client


@lru_cache
def get_client() -> Client:
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)

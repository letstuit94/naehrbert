"""
One-off data cleanup for verified_matches.store (Epic 4.2 follow-up).

Before services/verified_matches.py's normalize_store() fix, `store` was
compared as an opaque exact string on both the write and read paths. The
189 rows imported from the old project's CSV export carried that project's
own store strings ("Netto Marken-Discount", "LIDL", "E center Cramer
(EDEKA)", even a stray "Lidl\\n") -- none of which match this app's own
receipt_text_parser._detect_store() output ("Netto", "Lidl", "Aldi", ...),
so 151 of 191 rows were silently unreachable via the exact-store lookup.

Fixing normalize_store() only prevents *future* mismatches; this script
re-normalizes the `store` column already sitting in the live table so
existing corrections become reachable too. Where renormalizing two
different rows collides onto the same (match_key, store) pair (the same
product corrected under two different store-string spellings), the more
recently updated row wins and the other is deleted -- matches this app's
existing "single user, last correction wins" policy (see
verified_matches.py's module docstring).

Run from the repo root: `python -m backend.scripts.renormalize_verified_match_stores`
"""

from collections import defaultdict

from backend.app.db.supabase import get_client
from backend.app.services.verified_matches import normalize_store


def renormalize_verified_match_stores() -> None:
    client = get_client()
    rows = client.table("verified_matches").select("*").execute().data or []

    groups: dict[tuple, list[dict]] = defaultdict(list)
    for row in rows:
        groups[(row["match_key"], normalize_store(row["store"]))].append(row)

    updated = 0
    deleted = 0
    for (_match_key, new_store), group in groups.items():
        group.sort(key=lambda r: r["updated_at"], reverse=True)
        keeper, *rest = group
        for row in rest:
            client.table("verified_matches").delete().eq("id", row["id"]).execute()
            deleted += 1
        if keeper["store"] != new_store:
            client.table("verified_matches").update({"store": new_store}).eq("id", keeper["id"]).execute()
            updated += 1

    print(f"Processed {len(rows)} rows -> {len(groups)} distinct (match_key, store) pairs.")
    print(f"Updated store on {updated} rows; deleted {deleted} duplicate rows.")


if __name__ == "__main__":
    renormalize_verified_match_stores()

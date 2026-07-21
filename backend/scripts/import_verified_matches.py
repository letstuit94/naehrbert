"""
One-off import of verified_matches_rows.csv (an export from the old
project's multi-user verified_matches table) into this app's simplified,
single-user verified_matches table (Epic 4.2).

Column differences from the old export, and why each is handled the way
it is:
  - "key" -> "match_key": renamed only; normalize_match_key() is
    unchanged from the old repo (see services/verified_matches.py), and
    every key in the CSV is confirmed idempotent under it (re-normalizing
    changes nothing), so the values carry over as-is.
  - "user_id", "source": dropped. Both belonged to the old repo's
    multi-user vote/consensus model, which this app doesn't have (single
    user -> a correction just overwrites its row). "source" is also
    fully redundant here: which of off_id/bls_code is set already says
    where a match came from.
  - "nova": dropped. Every row's nutrition JSON already carries the same
    value under nutrition.processed_score (verified 1:1 against all rows
    that had a non-empty nova column), so nothing is lost.
  - "nutrition": parsed from its JSON-string column into a dict as-is;
    its keys are a subset of NutritionValues' fields, so
    NutritionValues(**nutrition) (in resolver._learned) works unchanged.

Run from the repo root: `python -m backend.scripts.import_verified_matches`
"""

import csv
import json
from pathlib import Path

from backend.app.db import repo

_CSV_PATH = Path(__file__).resolve().parents[2] / "verified_matches_rows.csv"


def import_verified_matches() -> None:
    with _CSV_PATH.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    for row in rows:
        repo.upsert_verified_match(
            match_key=row["key"],
            store=row["store"] or "",
            matched_name=row["matched_name"] or None,
            off_id=row["off_id"] or None,
            bls_code=row["bls_code"] or None,
            nutrition=json.loads(row["nutrition"]) if row["nutrition"] else {},
        )

    print(f"Imported {len(rows)} verified matches from {_CSV_PATH.name}.")


if __name__ == "__main__":
    import_verified_matches()

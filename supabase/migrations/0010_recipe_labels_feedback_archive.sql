-- naehrbert recipe recommendations feature -- per-recipe dietary label,
-- thumbs up/down feedback, and archive (soft-delete).
--
-- Run this manually via the Supabase SQL editor (this project's migrations
-- aren't applied by a CLI/runner -- see the existing 0004+ files' own
-- notes); the columns below are additive and nullable, so existing rows
-- and the running app keep working before this is applied, they just
-- won't have dietary_label/feedback/archived_at populated yet.

-- dietary_label: Gemini classifies this itself as part of the structured
-- recipe-generation response (services/recipe_engine.py), based on the
-- recipe's ACTUAL ingredients rather than just the dietary style that was
-- requested -- reuses the same 4-value enum as profiles.dietary_style
-- (migration 0003) since both describe the same "how does this eat"
-- concept. Nullable: existing rows generated before this column existed
-- simply have no value, same convention as `servings` (migration 0006).
alter table recipes add column dietary_label text
    check (dietary_label in ('omnivore', 'pescatarian', 'vegetarian', 'vegan'));

-- feedback: thumbs up/down on a specific recipe. Deliberately its own
-- column here, not folded into user_feedback (migration 0004) -- that
-- table is a general NPS satisfaction score with no link to any one
-- recipe; this is a per-recipe binary rating, a different question with a
-- different shape, so it lives on the row it's actually about.
alter table recipes add column feedback text
    check (feedback in ('up', 'down'));

-- archived_at: soft-delete for the recipe list's "X" button -- keeps the
-- row (and its feedback) rather than losing it outright, same spirit as
-- pantry_removals' append-only ledger (migration 0008) over a hard delete.
alter table recipes add column archived_at timestamptz;

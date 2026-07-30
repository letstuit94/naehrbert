-- naehrbert Insights page gap-closing recommendations (Groq-generated).
-- One row per profile, replaced on each regenerate -- NOT an accumulating
-- history like `recipes` (0005_recipes.sql). `profile_id` is the primary
-- key itself so an upsert on it gives exactly that "keep only the latest"
-- semantics for free.
--
-- Run this manually via the Supabase SQL editor (this project's migrations
-- aren't applied by a CLI/runner -- see the existing 0004+ files' notes).
create table gap_recommendations (
    profile_id  smallint primary key references profiles(id) on delete cascade,
    summary     text not null,
    items       jsonb not null default '[]',
    created_at  timestamptz not null default now()
);

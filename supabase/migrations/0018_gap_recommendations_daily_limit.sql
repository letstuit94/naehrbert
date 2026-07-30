-- Insights page "Quick Wins" now allows up to 2 generated recommendations
-- per profile per (UTC) calendar day -- both kept and paged through on the
-- frontend, instead of a single row replaced on every regenerate
-- (0017_gap_recommendations.sql). profile_id can no longer be the primary
-- key since a profile now has multiple rows, so it's replaced with a
-- generated uuid, same convention as `recipes` (0005_recipes.sql).
--
-- Run this manually via the Supabase SQL editor (this project's migrations
-- aren't applied by a CLI/runner -- see the existing 0004+ files' notes).
alter table gap_recommendations drop constraint gap_recommendations_pkey;
alter table gap_recommendations add column id uuid primary key default gen_random_uuid();
create index gap_recommendations_profile_created_idx on gap_recommendations (profile_id, created_at desc);

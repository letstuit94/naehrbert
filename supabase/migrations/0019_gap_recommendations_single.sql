-- Reverts 0018's "up to 2 per day, paged" model back to a single current
-- recommendation per profile, replaced on regenerate. Regenerating just
-- gave more of the same without adding value -- regeneration is now
-- gated instead (services/recommendation_engine.py / api/recommendations.py):
-- once per (UTC) day, and only once a new receipt has been confirmed
-- since the last recommendation.
--
-- Run this manually via the Supabase SQL editor (this project's migrations
-- aren't applied by a CLI/runner -- see the existing 0004+ files' notes).

-- Keep only the most recent row per profile so profile_id can be the
-- primary key again (a plain PK add would fail on any profile with 2 rows).
delete from gap_recommendations a
  where a.created_at < (
    select max(b.created_at) from gap_recommendations b where b.profile_id = a.profile_id
  );

drop index if exists gap_recommendations_profile_created_idx;
alter table gap_recommendations drop constraint if exists gap_recommendations_pkey;
alter table gap_recommendations drop column id;
alter table gap_recommendations add primary key (profile_id);

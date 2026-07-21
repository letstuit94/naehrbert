-- naehrbert recipe recommendations feature — servings/portions
-- Nullable (no default), same convention as prep_minutes/cook_minutes on
-- this table: existing rows generated before this column existed simply
-- have no value, rather than needing a backfill.

alter table recipes add column servings smallint;

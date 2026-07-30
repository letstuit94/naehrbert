-- naehrbert real auth (Google + email via Supabase Auth) -- links each
-- profiles row to exactly one Supabase auth.users row, replacing the old
-- passwordless "pick a profile from a list" scheme (backend/app/core/auth.py).
--
-- Nullable and NOT backfilled: profiles created the old way (before real
-- accounts existed) stay unlinked until claimed once through the new
-- "is one of these you?" picker (api/auth.py) -- there's no way to guess
-- which auth user owns which pre-existing profile, so this deliberately
-- doesn't try.
--
-- Run this manually via the Supabase SQL editor (this project's migrations
-- aren't applied by a CLI/runner -- see the existing 0004+ files' notes).
alter table profiles add column auth_user_id uuid unique references auth.users(id) on delete cascade;
create index profiles_auth_user_id_idx on profiles (auth_user_id);

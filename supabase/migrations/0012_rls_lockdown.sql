-- naehrbert security lockdown -- resolves the Supabase advisor warnings on
-- v_pantry ("Security Definer View" / eye symbol) and the "Unrestricted"
-- badge on every table.
--
-- Context: this app never exposes Supabase to the browser. The frontend
-- talks only to the FastAPI backend (frontend/src/lib/api.ts, VITE_API_BASE_URL),
-- and the backend connects with the SERVICE_ROLE key
-- (backend/app/db/supabase.py). service_role bypasses RLS entirely, so the
-- two changes below are invisible to the app's own data flow -- they only
-- close the *public* Data API (anon / authenticated roles), which is enabled
-- by default on every Supabase project and would otherwise expose all rows.
--
-- 1) v_pantry: run with the caller's privileges, not the owner's. A view
--    defaults to security_invoker = off, i.e. it executes as its owner
--    (postgres) and thus IGNORES the RLS of receipt_items / receipts /
--    pantry_removals. security_invoker = on makes the underlying tables'
--    RLS apply to whoever queries the view. This is the exact fix the
--    Supabase advisor suggests, expressed as an ALTER so the 40-line SELECT
--    from 0009 isn't duplicated.
alter view v_pantry set (security_invoker = on);

-- 2) Enable RLS on every table. We add NO policies on purpose: RLS-enabled
--    with zero policies = deny-all for anon/authenticated, while service_role
--    (the backend) keeps its bypass. This turns the whole Data API surface
--    off without touching any data, column, or app query. If direct
--    per-user browser access to Supabase is ever introduced, add explicit
--    policies then -- until that day, the backend is the only door in.
--
--    Run this manually via the Supabase SQL editor (this project's
--    migrations aren't applied by a CLI/runner -- see 0004+ files' notes).
alter table profiles         enable row level security;
alter table receipts         enable row level security;
alter table receipt_items    enable row level security;
alter table pantry_removals  enable row level security;
alter table pantry_shelf_life enable row level security;
alter table recipes          enable row level security;
alter table user_feedback    enable row level security;
alter table verified_matches enable row level security;
alter table non_food_terms   enable row level security;

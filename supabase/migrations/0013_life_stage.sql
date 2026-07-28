-- naehrbert DGE micronutrient targets (services/dge_matcher.py) need
-- pregnancy/nursing status alongside the age/sex already on file -- the
-- DGE reference table gives materially higher targets for these life
-- stages (e.g. Folat 550µg vs 300µg, Eisen 27mg vs 16mg while pregnant).
-- Nullable with an app-layer default of 'none' (see models/profile.py's
-- LifeStage.NONE), same convention as migration 0011's household columns:
-- existing profiles predate this column and behave exactly as before.
--
-- Run this manually via the Supabase SQL editor (this project's migrations
-- aren't applied by a CLI/runner -- see the existing 0004+ files' notes).
alter table profiles add column life_stage text
    check (life_stage in ('none', 'pregnant_t1', 'pregnant_t2', 'pregnant_t3', 'nursing'));

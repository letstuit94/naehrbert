-- naehrbert Konsum.md Stufe 4 -- household size + personal consumption
-- share, collected at the end of onboarding. Both nullable (existing
-- profiles predate these columns, same convention as recipes.servings in
-- migration 0006): the app works fine without them, they just improve the
-- accuracy of absolute (not %-based) comparisons once wired into that
-- calculation -- see Konsum.md's Stufe 4 for the full reasoning.
--
-- Run this manually via the Supabase SQL editor (this project's migrations
-- aren't applied by a CLI/runner -- see the existing 0004+ files' notes).
alter table profiles add column household_size smallint
    check (household_size between 1 and 20);
alter table profiles add column consumption_share_pct numeric
    check (consumption_share_pct between 1 and 100);

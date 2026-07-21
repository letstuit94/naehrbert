-- naehrbert clean rebuild — add profiles.name
-- Purely cosmetic (address the user by name in the onboarding chat / Profile
-- page); never used in any BMR/TDEE/macro calculation, hence nullable with
-- no check constraint. Run once via the Supabase SQL editor.

alter table profiles add column name text;

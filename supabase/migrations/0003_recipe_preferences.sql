-- naehrbert recipe recommendations feature — dietary preferences on profiles
-- Already applied via the Supabase SQL editor; committed here for the
-- record (this file didn't get written to disk at the time it was run).
-- dietary_style/allergies/dislikes are collected in the recipe-preferences
-- chat (or edited on the Profile page), never during onboarding — hence
-- nullable/defaulted, not part of the original profiles NOT NULL columns.
-- recipe_prefs_completed_at gates whether that chat still has anything
-- left to ask.

alter table profiles add column dietary_style text check (dietary_style in ('omnivore','pescatarian','vegetarian','vegan'));
alter table profiles add column allergies text[] not null default '{}';
alter table profiles add column dislikes text[] not null default '{}';
alter table profiles add column recipe_prefs_completed_at timestamptz;

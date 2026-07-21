-- naehrbert recipe recommendations feature — generated recipes
-- Already applied via the Supabase SQL editor; committed here for the
-- record (this file didn't get written to disk at the time it was run).
--
-- `ingredients` (jsonb) stores [{name, quantity}] — a natural-language
-- amount per ingredient (e.g. "200 g", "1 tbsp"), not a fixed schema.
-- `has_low_confidence_ingredient` is unused dead weight: an earlier design
-- planned to re-resolve each ingredient through the app's own nutrition
-- matcher and flag low-confidence matches, but the shipped design has
-- Gemini estimate the whole recipe's nutrition itself (see
-- backend/app/models/recipe.py's docstring for why) — nothing ever
-- resolves ingredients individually, so this column is always left at its
-- default. Harmless to drop later; not worth a migration just for that.
create table recipes (
    id                             uuid primary key default gen_random_uuid(),
    profile_id                     smallint not null default 1 references profiles(id),
    title                          text not null,
    ingredients                    jsonb not null default '[]',
    steps                          text[] not null default '{}',
    prep_minutes                   smallint,
    cook_minutes                   smallint,
    calories_kcal                  numeric,
    protein_g                      numeric,
    fat_g                          numeric,
    carbs_g                        numeric,
    fiber_g                        numeric,
    has_low_confidence_ingredient  boolean not null default false,
    created_at                     timestamptz not null default now()
);
create index recipes_profile_id_created_at_idx on recipes (profile_id, created_at desc);

-- naehrbert clean rebuild — init schema
-- Single-user app: no user_id columns, no RLS, no auth tables, no storage bucket.
-- Run once, in full, via the Supabase SQL editor (or `supabase db execute`).

-- ── profiles ────────────────────────────────────────────────────────────
-- Exactly one row (Epic 0.2 / 1.1). id is pinned to 1 and CHECK-enforced so
-- a second row can never be inserted; "create-or-replace" = upsert onto id=1.
create table profiles (
    id                  smallint primary key default 1,
    sex                 text not null check (sex in ('female', 'male', 'prefer_not_to_say')),
    date_of_birth       date not null,
    height_cm           numeric not null check (height_cm between 100 and 250),
    weight_kg           numeric not null check (weight_kg between 30 and 300),
    exercise_frequency  text not null check (exercise_frequency in ('none', 'one_two', 'three_four', 'five_six', 'daily_athlete')),
    daily_movement      text not null check (daily_movement in ('mostly_sitting', 'mixed', 'mostly_standing', 'physical_labor')),
    goal                text not null check (goal in ('lose_weight_gradually', 'maintain', 'build_muscle')),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    constraint single_row check (id = 1)
);

-- ── receipts ────────────────────────────────────────────────────────────
-- One row per upload. raw_text keeps the OCR/extracted text for debugging
-- and re-parsing (Epic 3.1); status flips to 'confirmed' when the review
-- screen (Epic 3.4) finalizes the receipt and triggers matching.
create table receipts (
    id            uuid primary key default gen_random_uuid(),
    source        text not null check (source in ('image', 'pdf', 'pasted_text')),
    raw_text      text,
    store         text,
    purchased_at  date,
    status        text not null default 'pending' check (status in ('pending', 'confirmed')),
    created_at    timestamptz not null default now()
);

-- ── receipt_items ───────────────────────────────────────────────────────
-- Parsed line items + matched nutrition data. Field names mirror
-- MatchedProduct / NutritionValues in carry_over/nutrition.py 1:1 so the
-- ported resolver/matcher code can persist its output without translation.
create table receipt_items (
    id                 uuid primary key default gen_random_uuid(),
    receipt_id         uuid not null references receipts(id) on delete cascade,

    -- parsed fields (receipt_text_parser.py)
    name               text not null,
    original_text      text,
    quantity           numeric,
    unit               text,
    price              numeric,
    category           text,
    is_non_food        boolean not null default false,
    uncertain          boolean not null default false,

    -- match metadata (MatchedProduct)
    match_type         text check (match_type in ('learned', 'exact', 'fuzzy', 'bls', 'fallback', 'none')),
    confidence         numeric check (confidence between 0 and 1),
    identity_conf      numeric check (identity_conf between 0 and 1),
    nutrition_conf     numeric check (nutrition_conf between 0 and 1),
    unknown            boolean not null default false,
    data_source        text,
    matched_name       text,
    brand              text,
    off_id             text,
    bls_code           text,
    fallback_category  text,

    -- nutrition values (NutritionValues, per 100g)
    protein_g          numeric,
    fat_g              numeric,
    carbs_g            numeric,
    saturated_fat_g    numeric,
    fiber_g            numeric,
    sugar_g            numeric,
    calories_kcal      numeric,
    processed_score    numeric,
    iron_mg            numeric,
    calcium_mg         numeric,
    micros             jsonb not null default '{}'::jsonb,
    sources            jsonb not null default '{}'::jsonb,

    created_at         timestamptz not null default now()
);

create index receipt_items_receipt_id_idx on receipt_items (receipt_id);

-- ── verified_matches ────────────────────────────────────────────────────
-- User-corrected matches (Epic 4.2), keyed the same way as the ported
-- verified_matches.normalize_match_key(). Deliberately simplified vs. the
-- old repo's multi-user vote/consensus model — single user, so a correction
-- just overwrites the row for its key instead of being tallied.
create table verified_matches (
    id            uuid primary key default gen_random_uuid(),
    match_key     text not null,
    store         text not null default '',
    matched_name  text,
    off_id        text,
    bls_code      text,
    nutrition     jsonb not null default '{}'::jsonb,
    updated_at    timestamptz not null default now(),
    unique (match_key, store)
);

-- ── non_food_terms ──────────────────────────────────────────────────────
-- Learned "not food" corrections (non_food_terms.record_non_food_term),
-- filtered out of future receipts at upload time.
create table non_food_terms (
    id          uuid primary key default gen_random_uuid(),
    term_key    text not null unique,
    raw_text    text,
    created_at  timestamptz not null default now()
);

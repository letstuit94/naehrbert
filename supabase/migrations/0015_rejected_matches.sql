-- naehrbert rejected-match store (Fix-match quality follow-up) -- the
-- negative counterpart to verified_matches: when a user dismisses a
-- candidate in the "Fix match" search panel (the X button) as not a real
-- match for a product, that candidate is remembered and excluded from
-- future searches for the same normalized text -- across every future
-- receipt, not just the item being corrected right now.
--
-- match_key uses the exact same normalizer as verified_matches
-- (services/verified_matches.normalize_match_key), so a rejection recorded
-- against one receipt's abbreviated OCR text also fires for any other
-- receipt line that normalizes to the same key.
--
-- Run this manually via the Supabase SQL editor (this project's migrations
-- aren't applied by a CLI/runner -- see the existing 0004+ files' notes).
create table rejected_matches (
    id          uuid primary key default gen_random_uuid(),
    match_key   text not null,
    source      text not null check (source in ('off', 'bls')),
    external_id text not null,
    created_at  timestamptz not null default now(),
    unique (match_key, source, external_id)
);

create index rejected_matches_match_key_idx on rejected_matches (match_key);

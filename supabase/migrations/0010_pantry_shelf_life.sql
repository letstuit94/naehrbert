-- naehrbert pantry: per-user shelf-life estimates (Bestandsliste / urgency).
--
-- The basket has NO expiry date per item -- only a real purchase date and a
-- coarse food group. Urgency ("use this soon") is therefore ESTIMATED as
-- purchased_at + shelf_life_days(food_group). The estimate drives ordering
-- and a fuzzy traffic-light only; the derived date itself is never sent to
-- the client (see api/pantry.py) -- it is a guess, not a fact.
--
-- The estimated shelf life per food group is CONFIG, not hard-coded and not
-- a field on the item: this table lets a user tune the days for a group
-- (e.g. their bread lasts 3 days, not 5). It stores only OVERRIDES -- a
-- group with no row falls back to services/shelf_life.py DEFAULT_SHELF_LIFE,
-- so a brand-new profile needs no seed rows and still gets sensible urgency.
--
-- food_group is one of the coarse groups in services/shelf_life.py
-- (FOOD_GROUPS); shelf_life_days is nullable on purpose -- NULL means "no
-- estimate" (the "Other / Miscellaneous" bucket), which sorts to the end and
-- never colours the traffic-light. A user may also null a group out to opt
-- it out of urgency entirely.

create table pantry_shelf_life (
    profile_id       smallint not null references profiles(id) on delete cascade,
    food_group       text not null,
    shelf_life_days  integer check (shelf_life_days is null or shelf_life_days > 0),
    updated_at       timestamptz not null default now(),
    primary key (profile_id, food_group)
);

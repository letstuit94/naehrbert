-- naehrbert recipe recommendations feature — one-time NPS feedback
-- Already applied via the Supabase SQL editor; committed here for the
-- record (this file didn't get written to disk at the time it was run).
-- profile_id anchors to the current single profile row (id=1), the same
-- pattern the rest of the schema would need to generalize once real
-- multi-user auth exists.

create table user_feedback (
    id          uuid primary key default gen_random_uuid(),
    profile_id  smallint not null default 1 references profiles(id),
    nps_score   smallint not null check (nps_score between 1 and 10),
    created_at  timestamptz not null default now()
);
create index user_feedback_profile_id_idx on user_feedback (profile_id);

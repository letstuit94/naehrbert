-- naehrbert pantry / basket (Vorrat.md) -- the "what's currently in my
-- stock" view, computed as: purchases (receipt_items) MINUS withdrawals.
--
-- Design decision (Vorrat.md §2): withdrawals are an append-only LEDGER,
-- never a status column on receipt_items. receipt_items is an immutable
-- purchase fact ("receipt X listed item Y"), and the consumption/macro
-- analytics (db/repo.get_all_confirmed_receipt_items ->
-- services/basket_composition.py) estimate consumption *from* purchases via
-- mass balance. If a "this was eaten" flag lived on receipt_items and that
-- analytics filtered it out, it would double-count the correction. So the
-- pantry status lives in a separate table the purchase analytics ignores by
-- default, and the pantry itself is derived at read time -- never stored.

create table pantry_removals (
    id               uuid primary key default gen_random_uuid(),
    -- Bound to the exact receipt_items row (a "lot"), not a product name:
    -- that row already carries the nutrition + quantity + unit + match
    -- origin, so pantry and (later) nutrition math stay precise. Cascade
    -- keeps the ledger clean if the underlying item is ever deleted.
    receipt_item_id  uuid not null references receipt_items(id) on delete cascade,
    -- 'eaten' (gegessen -> counts as consumption) vs 'removed' (entfernt ->
    -- left the pantry WITHOUT being consumed: spoiled, given away, miscan).
    -- Both reduce the pantry; only the consumption-gap analysis (later)
    -- treats them differently (GapUndEmpfehlung.md §4), which is why the
    -- distinction is captured from day one instead of a single "gone" flag.
    reason           text not null check (reason in ('eaten', 'removed')),
    -- Optional partial withdrawal (g/ml/piece). MVP leaves this NULL = the
    -- whole lot is gone; the column exists now so partial consumption needs
    -- no future migration (Vorrat.md §6.4).
    quantity         numeric,
    removed_at       timestamptz not null default now()
);

create index pantry_removals_item_idx on pantry_removals (receipt_item_id);

-- Read model (Vorrat.md §4): a lot is in the pantry when it belongs to a
-- confirmed receipt, is food, and has NO withdrawal yet. profile_id/store/
-- purchased_at are lifted from the parent receipt so the API can scope by
-- owner and render "1 Stück · 05.01. · Lidl" without a second join. Ownership
-- is transitive through receipts.profile_id -- no redundant column here.
create view v_pantry as
select
    ri.*,
    r.profile_id   as profile_id,
    r.store        as store,
    r.purchased_at as purchased_at
from receipt_items ri
join receipts r on r.id = ri.receipt_id
where r.status = 'confirmed'
  and ri.is_non_food = false
  and not exists (
      select 1 from pantry_removals pr where pr.receipt_item_id = ri.id
  );

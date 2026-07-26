-- naehrbert pantry: partial withdrawals (Vorrat.md §6.4).
--
-- 0008's v_pantry was binary: a lot vanished as soon as ANY removal existed
-- (`not exists`). To support "ate 0.2 l of 3 l" / "used 250 g of 500 g", the
-- pantry now derives a REMAINING quantity per lot and hides it only once that
-- reaches zero. pantry_removals.quantity (already on the table) carries the
-- withdrawn amount, expressed in the lot's own unit -- so the subtraction is
-- always unit-consistent and never mixes g with pieces.
--
-- Legacy rows: a NULL pantry_removals.quantity means "whole lot" (0008's
-- binary write). COALESCE(pr.quantity, base) treats such a row as removing
-- the full amount, so old whole-lot removals keep hiding their lot exactly
-- as before. A NULL receipt_items.quantity (no parsed amount) is treated as
-- one unit for this arithmetic -- the parser's own default is 1.0 anyway.

drop view if exists v_pantry;

create view v_pantry as
select
    ri.*,
    r.profile_id   as profile_id,
    r.store        as store,
    r.purchased_at as purchased_at,
    coalesce(ri.quantity, 1) - coalesce((
        select sum(coalesce(pr.quantity, coalesce(ri.quantity, 1)))
        from pantry_removals pr
        where pr.receipt_item_id = ri.id
    ), 0) as remaining_quantity
from receipt_items ri
join receipts r on r.id = ri.receipt_id
where r.status = 'confirmed'
  and ri.is_non_food = false
  and coalesce(ri.quantity, 1) - coalesce((
        select sum(coalesce(pr.quantity, coalesce(ri.quantity, 1)))
        from pantry_removals pr
        where pr.receipt_item_id = ri.id
    ), 0) > 0;

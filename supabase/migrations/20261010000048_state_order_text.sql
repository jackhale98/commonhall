-- A governor's order's own words: its Mass Register number and its text (the
-- WHEREAS clauses and what it orders, section by section), read with the rest of
-- the order's page by the Load governor orders workflow.

alter table public.state_executive_orders
  add column register text,
  add column body text;

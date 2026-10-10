-- Governors' orders keep a short summary, not their full text: what the order does
-- (the opening of what it orders) and why (its first stated reason). The full text
-- stays on mass.gov, a link away.

alter table public.state_executive_orders
  drop column body,
  add column summary text,
  add column reason text;

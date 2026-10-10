-- "Ask for a public discussion" sat on every detail page and made three requests per
-- view (the discussion, the count, and whether this browser asked). One call now.
create or replace function public.discussion_request_state(
  p_target_type text, p_target_id text, p_client_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'count', public.discussion_request_count(p_target_type, p_target_id),
    'mine', case when p_client_id is null then null
                 else public.has_anonymous_discussion_request(p_client_id, p_target_type, p_target_id) end,
    'discussion', (
      select jsonb_build_object('id', d.id, 'title', d.title, 'status', d.status)
        from public.discussions d
       where d.target_type = p_target_type and d.target_id = p_target_id and d.status <> 'draft'
       limit 1));
$$;

revoke all on function public.discussion_request_state(text, text, uuid) from public;
grant execute on function public.discussion_request_state(text, text, uuid) to anon, authenticated;

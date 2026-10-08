-- Scheduled syncs used to skip quietly when the Vault secrets were missing, so the
-- cron run still showed "succeeded". Fail loudly instead: the run is marked failed
-- in cron.job_run_details with a message saying what to fix.
create or replace function private.invoke_sync(fn text, body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  secret text;
  request_id bigint;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'sync_secret';
  if base_url is null or secret is null then
    raise exception 'invoke_sync(%): Vault secrets named project_url and sync_secret are missing (see docs/deployment.md, step 6)', fn
      using hint = 'select name from vault.decrypted_secrets; -- names must be exactly project_url and sync_secret';
  end if;
  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/' || fn,
    headers := jsonb_build_object('content-type', 'application/json', 'x-sync-secret', secret),
    body := body,
    timeout_milliseconds := 150000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function private.invoke_sync(text, jsonb) from public, anon, authenticated;

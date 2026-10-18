#!/usr/bin/env bash
# Serve Edge Functions with Deno against the local Supabase database and check that
# each boots and answers (CI; CLAUDE.md review item 15). No upstream API is called:
# each request is answered by the function's own checks or by the database.
#
#   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres scripts/smoke-functions.sh
set -euo pipefail
cd "$(dirname "$0")/../supabase/functions"
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL}"
export SYNC_SECRET=smoke-test-secret

failures=0
expect() { # name expected actual
  if [ "$2" = "$3" ]; then echo "ok   $1 ($3)"; else echo "FAIL $1: expected $2, got $3"; failures=$((failures + 1)); fi
}

serve() { # function
  deno run --allow-net --allow-env --allow-read --allow-sys "$1/index.ts" > "/tmp/smoke-$1.log" 2>&1 &
  pid=$!
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null http://localhost:8000/; then return 0; fi
    sleep 1
  done
  echo "FAIL $1 did not start"; cat "/tmp/smoke-$1.log"; exit 1
}
stop() { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

serve geocode
expect 'geocode: preflight' 204 "$(status -X OPTIONS http://localhost:8000/)"
expect 'geocode: too-short address' 400 "$(status -X POST -H 'content-type: application/json' -d '{"address":"x"}' http://localhost:8000/)"
stop

serve fetch-on-demand
expect 'fetch-on-demand: bad id' 400 "$(status 'http://localhost:8000/?kind=bill&id=nope')"
# A valid request reaches the database (the per-client limit) before it needs the
# Congress.gov key, which CI doesn't have: it answers 502, and a hit is counted.
expect 'fetch-on-demand: reaches the database' 502 "$(status -H 'x-forwarded-for: 203.0.113.250' 'http://localhost:8000/?kind=bill&id=119-hr-1')"
hits=$(psql "$SUPABASE_DB_URL" -tAc "select count(*) from private.rate_limits where bucket = 'fetch-on-demand'")
expect 'fetch-on-demand: per-client hit recorded' 1 "$( [ "$hits" -ge 1 ] && echo 1 || echo 0)"
stop

serve sync-executive
expect 'sync-executive: no secret' 401 "$(status -X POST http://localhost:8000/)"
stop

if [ "$failures" -gt 0 ]; then echo "$failures smoke check(s) failed"; exit 1; fi
echo 'All functions served and answered.'

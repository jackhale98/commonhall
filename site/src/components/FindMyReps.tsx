import { useEffect, useState } from 'preact/hooks';
import { accountUrl, followMany, getClient, getSession, hasStoredSession, savePendingFollows } from '../lib/auth';
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabase } from '../lib/config';
import { memberRole, partyClass, partyLabel, stateName } from '../lib/format';
import { memberHref } from '../lib/paths';
import { select } from '../lib/rest';
import FollowButton from './FollowButton';
import MemberPhoto from './MemberPhoto';

interface FederalRep {
  bioguide_id: string;
  name: string;
  party: string | null;
  state: string | null;
  district: number | null;
  chamber: 'house' | 'senate' | null;
  photo_url: string | null;
}

interface StateRep {
  id: string;
  name: string;
  party: string | null;
  state: string;
  chamber: string | null;
  district: string | null;
  photo_url: string | null;
  openstates_url: string | null;
}

interface Result {
  matchedAddress: string;
  state: string | null;
  congressionalDistrict: number | null;
  stateUpper: string | null;
  stateLower: string | null;
  federal: FederalRep[];
  stateLegislators: StateRep[];
}

interface Profile {
  address_label: string | null;
  state: string | null;
  congressional_district: number | null;
  state_upper_district: string | null;
  state_lower_district: string | null;
}

interface Props {
  /** On the account page: start from the saved districts (no lookup needed). */
  saved?: boolean;
}

const chamberName = (c: string | null, state: string) =>
  c === 'upper' ? (state === 'NE' ? 'Legislature' : 'State Senate') : c === 'lower' ? 'State House' : 'Legislature';

/** Reps for saved districts, read from our own tables (no geocoding, no upstream calls). */
async function repsFromProfile(p: Profile): Promise<Result | null> {
  if (!p.state) return null;
  const [federal, upper, lower] = await Promise.all([
    select<FederalRep>('members', {
      select: 'bioguide_id,name,party,state,district,chamber,photo_url',
      current: 'eq.true',
      state: `eq.${p.state}`,
      or:
        p.congressional_district === null
          ? '(chamber.eq.senate)'
          : `(chamber.eq.senate,and(chamber.eq.house,district.eq.${p.congressional_district}))`,
      order: 'chamber.desc,name.asc',
    }),
    p.state_upper_district
      ? select<StateRep>('state_legislators', {
          state: `eq.${p.state}`,
          chamber: 'in.(upper,legislature)',
          district: `eq.${p.state_upper_district}`,
          current: 'eq.true',
        })
      : Promise.resolve([]),
    p.state_lower_district
      ? select<StateRep>('state_legislators', {
          state: `eq.${p.state}`,
          chamber: 'eq.lower',
          district: `eq.${p.state_lower_district}`,
          current: 'eq.true',
        })
      : Promise.resolve([]),
  ]);
  return {
    matchedAddress: p.address_label ?? '',
    state: p.state,
    congressionalDistrict: p.congressional_district,
    stateUpper: p.state_upper_district,
    stateLower: p.state_lower_district,
    federal,
    stateLegislators: [...upper, ...lower],
  };
}

export default function FindMyReps({ saved = false }: Props) {
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!hasStoredSession()) return;
    (async () => {
      const session = await getSession();
      setSignedIn(Boolean(session));
      if (!session || !saved) return;
      const client = await getClient();
      const { data } = await client
        .from('profiles')
        .select('address_label,state,congressional_district,state_upper_district,state_lower_district')
        .maybeSingle();
      if (data) {
        setSavedLabel(data.address_label);
        setResult(await repsFromProfile(data as Profile));
      }
    })().catch(() => undefined);
  }, [saved]);

  async function lookup(e: Event) {
    e.preventDefault();
    if (!hasSupabase) {
      setMessage('Lookups are not available on this build.');
      setState('error');
      return;
    }
    setState('loading');
    setMessage('');
    setStatus('');
    try {
      const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/geocode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ address }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Lookup failed.');
      setResult(body as Result);
      setState('idle');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Lookup failed.');
      setState('error');
    }
  }

  const targets = result
    ? [
        ...result.federal.map((m) => ({ targetType: 'member', targetId: m.bioguide_id })),
        ...result.stateLegislators.map((l) => ({ targetType: 'state_legislator', targetId: l.id })),
      ]
    : [];

  async function followAll() {
    if (!signedIn) {
      savePendingFollows(targets, window.location.pathname);
      window.location.href = accountUrl(window.location.pathname);
      return;
    }
    try {
      await followMany(targets);
      setStatus(`Following ${targets.length} representatives. Reload to see the buttons update.`);
    } catch {
      setStatus('Could not follow everyone; please try again.');
    }
  }

  async function save() {
    if (!result) return;
    try {
      const client = await getClient();
      const { data } = await client.auth.getSession();
      if (!data.session) return;
      const { error } = await client.from('profiles').upsert({
        user_id: data.session.user.id,
        address_label: result.matchedAddress,
        state: result.state,
        congressional_district: result.congressionalDistrict,
        state_upper_district: result.stateUpper,
        state_lower_district: result.stateLower,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setSavedLabel(result.matchedAddress);
      setStatus('Saved to your account.');
    } catch {
      setStatus('Could not save; please try again.');
    }
  }

  async function forget() {
    const client = await getClient();
    const { data } = await client.auth.getSession();
    if (!data.session) return;
    await client.from('profiles').delete().eq('user_id', data.session.user.id);
    setSavedLabel(null);
    setResult(null);
    setStatus('Your saved address was removed.');
  }

  return (
    <section class="find-reps card" aria-labelledby="reps-h">
      <h2 id="reps-h" class="h-small">
        {saved && savedLabel ? 'Your representatives' : 'Find your representatives'}
      </h2>
      {saved && savedLabel && (
        <p class="small muted">
          Saved for {savedLabel}.{' '}
          <button type="button" class="link-button" onClick={forget}>
            Remove
          </button>
        </p>
      )}
      <form class="reps-form" onSubmit={lookup}>
        <label for="reps-address" class={saved && savedLabel ? 'small' : 'visually-hidden'}>
          {saved && savedLabel ? 'Look up a different address' : 'Your street address'}
        </label>
        <div class="reps-row">
          <input
            id="reps-address"
            type="text"
            autocomplete="street-address"
            placeholder="Street address, city, state or ZIP"
            required
            minLength={5}
            maxLength={200}
            value={address}
            onInput={(e) => setAddress(e.currentTarget.value)}
          />
          <button type="submit" class="primary" disabled={state === 'loading'}>
            {state === 'loading' ? 'Looking up…' : 'Find'}
          </button>
        </div>
        <p class="small muted">Your address is used for this lookup only and isn’t stored unless you save it.</p>
      </form>
      {state === 'error' && (
        <p class="notice error" role="alert">
          {message}
        </p>
      )}

      {result && (
        <div aria-live="polite">
          {!saved && (
            <p class="small">
              <strong>{result.matchedAddress}</strong>
              {result.congressionalDistrict !== null && result.state && (
                <>
                  {' '}
                  · {stateName(result.state)}
                  {result.congressionalDistrict === 0 ? ' at large' : ` district ${result.congressionalDistrict}`}
                </>
              )}
            </p>
          )}
          <h3 class="h-small">In Congress</h3>
          <ul class="reps-list">
            {result.federal.map((m) => (
              <li>
                <MemberPhoto name={m.name} url={m.photo_url} size={48} />
                <div>
                  <a href={memberHref(m.bioguide_id)}>{m.name}</a>{' '}
                  <span class={`party ${partyClass(m.party)}`}>{partyLabel(m.party)}</span>
                  <p class="small muted">{memberRole({ ...m, current: true })}</p>
                </div>
                <FollowButton targetType="member" targetId={m.bioguide_id} label={m.name} />
              </li>
            ))}
          </ul>
          {result.stateLegislators.length > 0 && (
            <>
              <h3 class="h-small">In your statehouse</h3>
              <ul class="reps-list">
                {result.stateLegislators.map((l) => (
                  <li>
                    <MemberPhoto name={l.name} url={l.photo_url} size={48} />
                    <div>
                      {l.openstates_url ? (
                        <a href={l.openstates_url} rel="noopener">
                          {l.name}
                        </a>
                      ) : (
                        l.name
                      )}{' '}
                      {l.party && <span class={`party ${partyClass(l.party)}`}>{l.party}</span>}
                      <p class="small muted">
                        {chamberName(l.chamber, l.state)}
                        {l.district ? `, district ${l.district}` : ''}
                      </p>
                    </div>
                    <FollowButton targetType="state_legislator" targetId={l.id} label={l.name} />
                  </li>
                ))}
              </ul>
            </>
          )}
          <p class="cluster">
            <button type="button" class="primary" onClick={followAll}>
              Follow all {targets.length}
            </button>
            {signedIn && !saved && (
              <button type="button" onClick={save}>
                Save to my account
              </button>
            )}
          </p>
          {status && <p class="small">{status}</p>}
        </div>
      )}
    </section>
  );
}

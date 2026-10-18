import { useEffect, useState } from 'preact/hooks';
import Loader from './Loader';
import { areaLabel } from '../lib/address';
import { CITIES, CITY_LIST, numberWord } from '../lib/cities';
import { accountUrl, followMany, getClient, getSession, hasStoredSession, savePendingFollows } from '../lib/auth';
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabase } from '../lib/config';
import { memberRole, partyClass, partyLabel, stateName } from '../lib/format';
import { deviceArea, forgetArea, rememberArea, type MyArea } from '../lib/my-area';
import { href, localOfficialHref, memberHref, stateLegislatorHref } from '../lib/paths';
import { repsFromProfile, type Profile, type Result } from '../lib/reps';
import FollowButton from './FollowButton';
import MemberPhoto from './MemberPhoto';

interface Props {
  /** On the account page: start from the districts saved to the account only, not this device's. */
  saved?: boolean;
  /** A sentence under the heading before any lookup (the home page says what it's for). */
  intro?: string;
}

/** Where the representatives on show came from: the account, this device, or a lookup just now. */
type Origin = 'account' | 'device' | null;

const chamberName = (c: string | null, state: string) =>
  c === 'upper' ? (state === 'NE' ? 'Legislature' : 'State Senate') : c === 'lower' ? 'State House' : 'Legislature';

/** The city we cover that an address is in (the first in the registry when unknown). */
const cityName = (city: string | null | undefined) => CITIES[city ?? ''] ?? CITY_LIST[0]!;

/** The districts of a lookup, as kept on the device or in the account: never the street. */
const areaOf = (r: Result): MyArea => ({
  label: areaLabel(r.matchedAddress),
  state: r.state,
  congressional_district: r.congressionalDistrict,
  state_upper_district: r.stateUpper,
  state_lower_district: r.stateLower,
  city: r.city ?? null,
  council_district: r.councilDistrict ?? null,
});

export default function FindMyReps({ saved = false, intro }: Props) {
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [origin, setOrigin] = useState<Origin>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    // Arriving from search with an address (reps/?address=…): fill it in and look it up.
    const given = saved ? undefined : new URLSearchParams(window.location.search).get('address')?.trim();
    if (given) {
      setAddress(given);
      void lookupAddress(given);
    }
    (async () => {
      const session = hasStoredSession() ? await getSession() : null;
      setSignedIn(Boolean(session));
      if (given) return;
      // Start from the saved districts: the account's, else (except on the account page) this device's.
      if (session) {
        const client = await getClient();
        const { data } = await client
          .from('profiles')
          .select(
            'address_label,state,congressional_district,state_upper_district,state_lower_district,city,council_district',
          )
          .maybeSingle();
        if (data?.state) {
          setOrigin('account');
          setLabel(data.address_label ?? stateName(data.state));
          setResult(await repsFromProfile(data as Profile));
          return;
        }
      }
      const device = saved ? null : deviceArea();
      if (device) {
        setOrigin('device');
        setLabel(device.label ?? stateName(device.state));
        setResult(await repsFromProfile({ ...device, address_label: device.label }));
      }
    })().catch(() => undefined);
  }, [saved]);

  function lookup(e: Event) {
    e.preventDefault();
    void lookupAddress(address);
  }

  async function lookupAddress(address: string) {
    if (!hasSupabase) {
      setMessage('Lookups are not available on this build.');
      setState('error');
      return;
    }
    // The Census geocoder matches street addresses only, and a ZIP code can span districts.
    if (!/\d+\s+\S/.test(address.replace(/\b\d{5}(-\d{4})?\b/g, '').trim())) {
      setMessage(
        'A ZIP code alone isn’t enough: one ZIP can cover several districts. Enter your street address, for example “123 Main St, Boston, MA”, or browse your state below.',
      );
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
      if (!response.ok) throw new Error(body.error ?? 'We couldn’t look up that address. Check it and try again.');
      setResult(body as Result);
      setOrigin(null);
      setState('idle');
    } catch (err) {
      // A network failure ("Failed to fetch") says nothing useful to a reader.
      setMessage(
        err instanceof TypeError || !(err instanceof Error)
          ? 'We couldn’t reach the address lookup just now. Try again in a minute, or browse your state below.'
          : err.message,
      );
      setState('error');
    }
  }

  const targets = result
    ? [
        ...result.federal.map((m) => ({ targetType: 'member', targetId: m.bioguide_id })),
        ...result.stateLegislators.map((l) => ({ targetType: 'state_legislator', targetId: l.id })),
        ...(result.localOfficials ?? []).map((o) => ({ targetType: 'local_official', targetId: o.id })),
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
      const area = areaOf(result);
      const { error } = await client.from('profiles').upsert({
        user_id: data.session.user.id,
        // Only the place (city, state, ZIP) is kept, never the street; the database enforces this too.
        address_label: area.label,
        state: area.state,
        congressional_district: area.congressional_district,
        state_upper_district: area.state_upper_district,
        state_lower_district: area.state_lower_district,
        city: area.city,
        council_district: area.council_district,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setOrigin('account');
      setLabel(area.label ?? stateName(result.state));
      setStatus('Saved to your account: your districts and town, not your street address.');
    } catch {
      setStatus('Could not save; please try again.');
    }
  }

  function remember() {
    if (!result) return;
    const area = areaOf(result);
    rememberArea(area);
    setOrigin('device');
    setLabel(area.label ?? stateName(result.state));
    setStatus('Remembered on this device: your districts and town, not your street address.');
  }

  async function forget() {
    if (origin === 'device') {
      forgetArea();
    } else {
      const client = await getClient();
      const { data } = await client.auth.getSession();
      if (!data.session) return;
      // Clear the address but keep the row: its random Pol.is id keeps discussion votes together.
      await client
        .from('profiles')
        .update({
          address_label: null,
          state: null,
          congressional_district: null,
          state_upper_district: null,
          state_lower_district: null,
          city: null,
          council_district: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', data.session.user.id);
    }
    setStatus(origin === 'device' ? 'Forgotten on this device.' : 'Your saved address was removed.');
    setOrigin(null);
    setLabel(null);
    setResult(null);
  }

  const stored = origin !== null && label !== null;
  return (
    <section class="find-reps card" aria-labelledby="reps-h">
      <h2 id="reps-h" class="h-small">
        {stored ? 'Your representatives' : 'Find your representatives'}
      </h2>
      {intro && !stored && !result && <p class="reps-intro">{intro}</p>}
      {stored && (
        <p class="small muted">
          {origin === 'device' ? 'Remembered on this device' : 'Saved to your account'} for {label}.{' '}
          <button type="button" class="link-button" onClick={forget}>
            {origin === 'device' ? 'Forget' : 'Remove'}
          </button>
        </p>
      )}
      <form class="reps-form" onSubmit={lookup}>
        <label for="reps-address" class={stored ? 'small' : 'visually-hidden'}>
          {stored ? 'Look up a different address' : 'Your street address'}
        </label>
        <div class="reps-row">
          <input
            id="reps-address"
            type="text"
            autocomplete="street-address"
            placeholder="Street address, city and state"
            required
            minLength={5}
            maxLength={200}
            value={address}
            onInput={(e) => setAddress(e.currentTarget.value)}
          />
          <button type="submit" class="primary" disabled={state === 'loading'}>
            {state === 'loading' ? (
              <>
                <Loader inline />
                Looking up…
              </>
            ) : (
              'Find'
            )}
          </button>
        </div>
        {!stored && <p class="small muted">We never store your street address.</p>}
      </form>
      {state === 'error' && (
        <p class="notice error" role="alert">
          {message} <a href={href('states/')}>Browse by state</a>
        </p>
      )}

      {result && (
        <div aria-live="polite">
          {origin === null && (
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
          {origin === null && (
            <div class="reps-keep">
              {signedIn ? (
                <button type="button" class="primary" onClick={save}>
                  Save to my account
                </button>
              ) : (
                <button type="button" class="primary" onClick={remember}>
                  Remember on this device
                </button>
              )}
              <p class="small muted">
                Then the home page shows your representatives and how they voted
                {result.city ? ', and your city' : ''}.
                {signedIn ? '' : ' Only your districts and town are kept, in this browser.'}
              </p>
            </div>
          )}
          <h3 class="h-small">In Congress</h3>
          <ul class="reps-list">
            {result.federal.map((m) => (
              <li>
                <MemberPhoto name={m.name} url={m.photo_url} bioguideId={m.bioguide_id} size={44} />
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
                    <MemberPhoto name={l.name} url={l.photo_url} size={44} />
                    <div>
                      <a href={stateLegislatorHref(l.id)}>{l.name}</a>{' '}
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
          {result.localOfficials && result.localOfficials.length > 0 && (
            <>
              <h3 class="h-small">On the {cityName(result.city).council}</h3>
              <p class="small muted">
                {result.councilDistrict
                  ? `District ${result.councilDistrict} and the ${numberWord(cityName(result.city).atLarge)} at-large councilors.`
                  : 'The whole council: we match your address to the city, not to a district.'}
              </p>
              <ul class="reps-list">
                {result.localOfficials.map((o) => (
                  <li>
                    <MemberPhoto name={o.name} url={o.photo_url} size={44} />
                    <div>
                      <a href={localOfficialHref(o.id)}>{o.name}</a>
                      <p class="small muted">{o.seat ?? 'Councilor'}</p>
                    </div>
                    <FollowButton targetType="local_official" targetId={o.id} label={o.name} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {hasSupabase && targets.length > 1 && (
            <p class="cluster">
              <button type="button" onClick={followAll}>
                Follow all {targets.length}
              </button>
              <span class="small muted">to see their votes and bills in your feed.</span>
            </p>
          )}
        </div>
      )}
      {status && (
        <p class="small" role="status">
          {status}
        </p>
      )}
    </section>
  );
}

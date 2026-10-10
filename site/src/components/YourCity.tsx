import { useEffect, useState } from 'preact/hooks';
import { getClient, hasStoredSession } from '../lib/auth';
import { CITIES } from '../lib/cities';
import { formatMoney } from '../lib/finance';
import { formatDate } from '../lib/format';
import type { CityGlance, GlanceMeeting } from '../lib/glance';
import { budgetChange, change311, closeTime } from '../lib/local';
import { cityHref } from '../lib/paths';
import MemberPhoto from './MemberPhoto';

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : null);

/** A share as a labelled bar: one value, so no legend; the text carries the number. */
function Meter({ value, label }: { value: number; label: string }) {
  return (
    <span class="yc-meter" role="img" aria-label={label}>
      <span class="yc-meter-fill" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </span>
  );
}

function When({ m }: { m: GlanceMeeting }) {
  return (
    <>
      {formatDate(m.date)}
      {m.time && ` · ${m.time}`}
    </>
  );
}

/**
 * The signed-in visitor's city at a glance on the home page: their district
 * councilor, the next council meeting, 311 in their district and the city budget.
 * Reads the visitor's own saved city and district (profiles, by RLS) and the
 * city's glance.json built with the site; nothing when signed out or the saved
 * address isn't in a city we cover.
 */
export default function YourCity() {
  const [glance, setGlance] = useState<CityGlance | null>(null);
  const [district, setDistrict] = useState<number | null>(null);

  useEffect(() => {
    if (!hasStoredSession()) return;
    (async () => {
      const client = await getClient();
      const { data: session } = await client.auth.getSession();
      if (!session.session) return;
      const { data } = await client
        .from('profiles')
        .select('city,council_district')
        .eq('user_id', session.session.user.id)
        .maybeSingle();
      const city = data?.city ? CITIES[data.city] : undefined;
      if (!city) return;
      const res = await fetch(cityHref(city, 'glance.json'));
      if (!res.ok) return;
      setDistrict(data!.council_district ?? null);
      setGlance((await res.json()) as CityGlance);
    })().catch(() => undefined);
  }, []);

  if (!glance) return null;
  const g = glance;
  const councilor = district ? g.councilors.find((c) => c.district === district) : undefined;
  const atLarge = g.councilors.filter((c) => c.district === null).length;
  const s = g.report311 ? (district && g.report311.districts[district]) || g.report311.city : null;
  const where = district && g.report311?.districts[district] ? `District ${district}` : g.name;
  const onTime = s ? pct(s.closedOnTime, s.closed) : null;
  const change = s ? change311(s) : null;
  const maxTop = s ? Math.max(1, ...s.top.map((t) => t.n)) : 1;
  const op = g.operating;
  const fy = (y: number) => `FY${String(y).slice(2)}`;

  return (
    <section class="your-city" aria-labelledby="your-city-h">
      <div class="section-head">
        <h2 id="your-city-h">
          Your city: {g.name}
          {district ? <span class="muted"> · District {district}</span> : null}
        </h2>
        <a class="see-all" href={g.href}>
          {g.name}
        </a>
      </div>
      <div class="yc-grid">
        {(councilor || g.councilors.length > 0) && (
          <a class="yc-card" href={councilor ? councilor.href : `${g.council_href}#council-h`}>
            <span class="yc-label">
              <span class="dot dot-city" aria-hidden="true" />
              {councilor ? 'Your district councilor' : g.council}
            </span>
            {councilor ? (
              <span class="yc-person">
                <MemberPhoto name={councilor.name} url={councilor.photo_url} size={48} />
                <strong>{councilor.name}</strong>
              </span>
            ) : (
              <strong>{g.councilors.length} councilors</strong>
            )}
            <span class="yc-meta">
              {councilor ? `Plus ${atLarge} at-large councilors for the whole city` : 'Find yours by address'}
            </span>
          </a>
        )}

        {(g.next_council || g.next_committee) && (
          <a class="yc-card" href={g.next_council ? g.council_href + '#meetings-h' : g.committees_href}>
            <span class="yc-label">
              <span class="dot dot-live" aria-hidden="true" />
              Coming up
            </span>
            {g.next_council && (
              <>
                <strong>Council meeting</strong>
                <span class="yc-when">
                  <When m={g.next_council} />
                </span>
              </>
            )}
            {g.next_committee && (
              <span class="yc-meta">
                Next committee {g.session}: {g.next_committee.committees.join(' and ')}, <When m={g.next_committee} />
              </span>
            )}
          </a>
        )}

        {s && g.report311 && (
          <a class="yc-card" href={`${g.neighborhoods_href}${district ? `?district=${district}` : ''}`}>
            <span class="yc-label">
              <span class="dot dot-order" aria-hidden="true" />
              311 in {where}, last 30 days
            </span>
            <span class="yc-figure">
              <strong class="yc-big">{s.opened.toLocaleString()}</strong>
              <span class="yc-meta">requests{change && ` · ${change} the 30 days before`}</span>
            </span>
            {onTime !== null && (
              <span class="yc-row">
                <span class="yc-meta">
                  {onTime}% closed on time
                  {s.typicalHours !== null && `, typically in ${closeTime(s.typicalHours)}`}
                </span>
                <Meter value={onTime} label={`${onTime}% of requests closed on time`} />
              </span>
            )}
            {s.top.length > 0 && (
              <ul class="yc-top" aria-label={`Most common requests in ${where}`}>
                {s.top.map((t) => (
                  <li>
                    <span>{t.type}</span>
                    <span class="yc-top-bar" aria-hidden="true">
                      <span style={{ width: `${(t.n / maxTop) * 100}%` }} />
                    </span>
                    <span class="yc-num">{t.n.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </a>
        )}

        {(op || g.capital) && (
          <a class="yc-card" href={g.budget_href}>
            <span class="yc-label">
              <span class="dot dot-law" aria-hidden="true" />
              City budget{op ? `, ${fy(op.fiscalYear)}${op.stage === 'proposed' ? ' (proposed)' : ''}` : ''}
            </span>
            {op && (
              <span class="yc-figure">
                <strong class="yc-big">{formatMoney(op.total)}</strong>
                <span class="yc-meta">
                  to run the city
                  {op.prev > 0 && ` · ${budgetChange(op.total, op.prev)} on ${op.prevLabel}`}
                </span>
              </span>
            )}
            {op?.propertyTaxShare != null && (
              <span class="yc-row">
                <span class="yc-meta">{Math.round(op.propertyTaxShare * 100)}% paid for by property tax</span>
                <Meter
                  value={op.propertyTaxShare * 100}
                  label={`${Math.round(op.propertyTaxShare * 100)}% of revenue from property tax`}
                />
              </span>
            )}
            {g.capital && (
              <span class="yc-meta">
                {g.capital.name}: {formatMoney(g.capital.thisYear)} in {g.capital.yearLabel} across {g.capital.projects}{' '}
                projects
              </span>
            )}
          </a>
        )}
      </div>
    </section>
  );
}

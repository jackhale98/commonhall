import { useEffect, useState } from 'preact/hooks';
import { CITIES } from '../lib/cities';
import { formatMoney } from '../lib/finance';
import { formatDate } from '../lib/format';
import type { CityGlance, GlanceMeeting } from '../lib/glance';
import { budgetChange, change311, closeTime } from '../lib/local';
import { cityHref } from '../lib/paths';

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
 * The visitor's city at a glance on the home page, inside Your government (YourArea):
 * the next council meeting, 311 in their district and the city budget, from the
 * city's glance.json built with the site. Their councilor is listed with their other
 * representatives above.
 */
export default function YourCity({ city: key, district }: { city: string; district: number | null }) {
  const [glance, setGlance] = useState<CityGlance | null>(null);

  useEffect(() => {
    const city = CITIES[key];
    if (!city) return;
    fetch(cityHref(city, 'glance.json'))
      .then((res) => (res.ok ? (res.json() as Promise<CityGlance>) : null))
      .then(setGlance)
      .catch(() => undefined);
  }, [key]);

  if (!glance) return null;
  const g = glance;
  const s = g.report311 ? (district && g.report311.districts[district]) || g.report311.city : null;
  const where = district && g.report311?.districts[district] ? `${g.districtWord ?? 'District'} ${district}` : g.name;
  // Cities without target times (Somerville) show the share closed so far instead.
  const timed = g.report311?.onTime !== false;
  const onTime = s ? (timed ? pct(s.closedOnTime, s.closed) : pct(s.closed, s.opened)) : null;
  const closedWord = timed ? 'closed on time' : 'closed so far';
  const change = s ? change311(s) : null;
  const maxTop = s ? Math.max(1, ...s.top.map((t) => t.n)) : 1;
  const op = g.operating;
  const fy = (y: number) => `FY${String(y).slice(2)}`;

  return (
    <section class="your-city" aria-labelledby="your-city-h">
      <div class="section-head">
        <h3 id="your-city-h" class="h-small">
          {g.name}
          {district ? (
            <span class="muted">
              {' '}
              · {g.districtWord ?? 'District'} {district}
            </span>
          ) : null}
        </h3>
        <a class="see-all" href={g.href}>
          City page
        </a>
      </div>
      <div class="yc-grid">
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
                  {onTime}% {closedWord}
                  {s.typicalHours !== null && `, typically in ${closeTime(s.typicalHours)}`}
                </span>
                <Meter value={onTime} label={`${onTime}% of requests ${closedWord}`} />
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

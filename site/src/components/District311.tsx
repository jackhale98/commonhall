import { useEffect, useState } from 'preact/hooks';
import { change311, closeTime, type Report311, type Summary311 } from '../lib/local';
import { formatDate } from '../lib/format';
import BarList from './viz/BarList';

interface Props {
  report: Report311;
  /** District labels for the menu, e.g. 7 → "District 7 · Tania Fernandes Anderson". */
  districts?: { district: number; label: string }[];
  /** Show only this district, with no menu (councilor pages). */
  fixed?: number;
  /** How many request types to list. */
  top?: number;
  /** The city, for "All of Boston". */
  cityName: string;
  /** "District" or "Ward". */
  districtWord?: string;
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

/**
 * 311 at a glance for the last 30 days: requests (and the change on the 30 days
 * before), share closed on time, typical time to close, most common requests.
 * Citywide or for one council district, picked from a menu (kept in ?district=).
 */
export default function District311({
  report,
  districts = [],
  fixed,
  top = 8,
  cityName,
  districtWord = 'District',
}: Props) {
  const [district, setDistrict] = useState<number>(fixed ?? 0);

  useEffect(() => {
    if (fixed !== undefined) return;
    const d = Number(new URLSearchParams(location.search).get('district'));
    if (report.districts[d]) setDistrict(d);
  }, [fixed, report]);

  const pick = (d: number) => {
    setDistrict(d);
    const url = new URL(location.href);
    if (d) url.searchParams.set('district', String(d));
    else url.searchParams.delete('district');
    history.replaceState(null, '', url);
  };

  const s: Summary311 = (district && report.districts[district]) || report.city;
  const where = district ? `${districtWord} ${district}` : cityName;
  const change = change311(s);

  return (
    <div class="district-311">
      {fixed === undefined && districts.length > 0 && (
        <div class="explorer-filters">
          <label for="d311" class="visually-hidden">
            Council district
          </label>
          <select
            id="d311"
            value={district}
            class={district ? 'is-set' : ''}
            onChange={(e) => pick(Number(e.currentTarget.value))}
          >
            <option value={0}>All of {cityName}</option>
            {districts.map((d) => (
              <option value={d.district}>{d.label}</option>
            ))}
          </select>
        </div>
      )}
      <dl class="stat-grid">
        <div class="stat">
          <dt>Requests</dt>
          <dd>{s.opened.toLocaleString()}</dd>
          {change && <p class="small muted stat-note">{change} prior 30 days</p>}
        </div>
        <div class="stat">
          {/* Cities without target times (Somerville): the share closed so far. */}
          <dt>{report.onTime === false ? 'Closed so far' : 'Closed on time'}</dt>
          <dd>{report.onTime === false ? pct(s.closed, s.opened) : pct(s.closedOnTime, s.closed)}</dd>
          {s.typicalHours !== null && <p class="small muted stat-note">typically in {closeTime(s.typicalHours)}</p>}
        </div>
      </dl>
      {s.top.length > 0 && (
        <div class="panel top-311">
          <h3 class="h-small">Most common requests in {where}</h3>
          <BarList
            items={s.top.slice(0, top).map((t) => ({ label: t.type, value: t.n }))}
            label={`Most common 311 requests in ${where}, last 30 days`}
          />
        </div>
      )}
      <p class="small muted">
        {formatDate(report.from)} to {formatDate(report.to)}. Requests made to 311 by phone, app or the web, and
        reported by city workers.
      </p>
    </div>
  );
}

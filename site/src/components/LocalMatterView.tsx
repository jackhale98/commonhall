import { useEffect, useState } from 'preact/hooks';
import { formatDate } from '../lib/format';
import { cityOf, matterLabel } from '../lib/cities';
import { localOfficialHref } from '../lib/paths';
import { select } from '../lib/rest';
import { LOCAL_MATTER_COLUMNS, type LocalMatter, type LocalMatterAction } from '../lib/types';
import FollowButton from './FollowButton';

export interface Sponsor {
  official_id: string;
  name: string | null;
  sequence: number | null;
}

export interface MatterData {
  matter: LocalMatter;
  actions: LocalMatterAction[];
  sponsors: Sponsor[];
}

/** Load a matter, its actions and sponsors from Supabase. */
export async function loadMatter(id: string): Promise<MatterData | null> {
  const [matter] = await select<LocalMatter>('local_matters', { id: `eq.${id}`, select: LOCAL_MATTER_COLUMNS });
  if (!matter) return null;
  const [actions, sponsors] = await Promise.all([
    select<LocalMatterAction>('local_matter_actions', { matter_id: `eq.${id}`, order: 'seq.asc' }),
    select<Sponsor>('local_matter_sponsors', {
      matter_id: `eq.${id}`,
      select: 'official_id,name,sequence',
      order: 'sequence.asc.nullslast',
    }),
  ]);
  return { matter, actions, sponsors };
}

interface Props extends MatterData {
  /** Refresh from Supabase after hydration (prerendered pages). */
  live?: boolean;
  /** Official ids with a page on this site. */
  officialIds?: string[];
}

/** A city council matter: status, latest action, actions, sponsors. */
export default function LocalMatterView(props: Props) {
  const [data, setData] = useState<MatterData>(props);
  useEffect(() => {
    if (!props.live) return;
    loadMatter(props.matter.id)
      .then((fresh) => fresh && setData(fresh))
      .catch(() => undefined);
  }, [props.matter.id, props.live]);

  const { matter, actions, sponsors } = data;
  const known = new Set(props.officialIds ?? sponsors.map((s) => s.official_id));
  const label = matterLabel(matter);
  const city = cityOf(matter.id);
  return (
    <article>
      <p class="eyebrow">
        {label} · {city?.council ?? 'City Council'}
        {matter.type ? ` · ${matter.type}` : ''}
      </p>
      <h1 class="matter-title">{matter.title}</h1>
      <p class="meta cluster small">
        {matter.status && (
          <span>
            Status: <strong>{matter.status}</strong>
          </span>
        )}
        {matter.intro_date && <span>Filed {formatDate(matter.intro_date)}</span>}
        {matter.passed_date && <span>Passed {formatDate(matter.passed_date)}</span>}
      </p>
      <div class="cluster" style={{ margin: '1rem 0' }}>
        <FollowButton targetType="local_matter" targetId={matter.id} label={label} />
        {matter.legistar_url && (
          <a class="button" href={matter.legistar_url} rel="noopener">
            {city?.recordLabel ?? 'Full record'}
          </a>
        )}
      </div>

      {matter.latest_action_text && (
        <div class="latest-action" aria-live="polite">
          <h2 class="h-small">Latest action</h2>
          <p>
            {formatDate(matter.latest_action_date)}: {matter.latest_action_text}
          </p>
        </div>
      )}

      <section>
        <h2>Sponsors</h2>
        {sponsors.length === 0 ? (
          <p class="muted">None recorded.</p>
        ) : (
          <ul class="cluster plain-inline">
            {sponsors.map((s) => (
              <li>{known.has(s.official_id) ? <a href={localOfficialHref(s.official_id)}>{s.name}</a> : s.name}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Actions</h2>
        {actions.length === 0 ? (
          <p class="muted">No actions recorded yet.</p>
        ) : (
          <ol class="timeline">
            {[...actions].reverse().map((a) => (
              <li>
                <time datetime={a.action_date ?? undefined}>{formatDate(a.action_date)}</time>
                {a.body && <span class="chip">{a.body}</span>}
                <p>
                  {a.action_name ?? a.action_text}
                  {a.passed && <span class="muted"> ({a.passed})</span>}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p class="small muted">
        {city?.name ?? 'The city'} records roll-call votes in meeting minutes rather than item by item, so individual
        councilors’ votes are not shown. See the full record on the city’s site.
      </p>
    </article>
  );
}

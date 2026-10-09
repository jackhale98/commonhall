import { useEffect, useMemo, useState } from 'preact/hooks';
import { docketUrl, type CaseRow } from '../lib/court';
import { formatDate } from '../lib/format';
import { href, scotusCaseHref } from '../lib/paths';

const PAGE = 30;
/** Phones start with fewer, so the page's other sections stay close. */
const PHONE_PAGE = 8;
const pageSize = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 40rem)').matches ? PHONE_PAGE : PAGE;

type Kind = '' | 'argued' | 'summary';

interface Props {
  /** Prerendered rows: the latest decisions. */
  initial: CaseRow[];
  /** Terms with decisions, newest first. */
  terms: number[];
  /** Opinion authors, alphabetical ("Per Curiam" last). */
  authors: string[];
  /** Outcomes (who won, vote split) are loaded: show their filters. */
  outcomes?: boolean;
}

type Won = '' | 'p' | 'r';
type Vote = '' | 'unanimous' | 'divided' | 'close';
const dissenting = (v?: string) => (v ? Number(v.split('–')[1]) : null);

const termName = (t: number) => `${t}–${String(t + 1).slice(2)} term`;

const tags = (c: CaseRow) =>
  [
    c.w === 'p' ? 'Petitioner won' : c.w === 'r' ? 'Respondent won' : c.w === 'u' ? 'Mixed result' : null,
    c.v ? (dissenting(c.v) === 0 ? `${c.v}, unanimous` : c.v) : null,
    c.j ? (c.pc ? 'Per curiam (unsigned)' : `Opinion by ${c.j}`) : null,
    c.a ? null : 'Decided without oral argument',
    c.cc > 0 ? `${c.cc} concurring opinion${c.cc > 1 ? 's' : ''}` : null,
    c.ds > 0 ? `${c.ds} dissent${c.ds > 1 ? 's' : ''}` : null,
  ].filter(Boolean);

/**
 * Supreme Court decisions with search (case name, docket, citation) and filters
 * (term, author, argued or not, has a discussion). Starts from the prerendered latest
 * decisions and loads the full list (cases.json, built with the site) on view.
 */
export default function CaseExplorer({ initial, terms, authors, outcomes = false }: Props) {
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [author, setAuthor] = useState('');
  const [kind, setKind] = useState<Kind>('');
  const [won, setWon] = useState<Won>('');
  const [vote, setVote] = useState<Vote>('');
  const [discussed, setDiscussed] = useState(false);
  const [shown, setShown] = useState(PAGE);
  // Prerendered with PAGE rows (CSS trims them on phones until hydration); then the device's size.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setShown(pageSize());
    setMounted(true);
  }, []);

  useEffect(() => {
    fetch(href('court/cases.json'))
      .then((r) => (r.ok ? (r.json() as Promise<CaseRow[]>) : Promise.reject(new Error(String(r.status)))))
      .then(setRows)
      .catch(() => setFailed(true));
  }, []);

  const all = rows ?? initial;
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((c) => {
      if (term && c.t !== Number(term)) return false;
      if (author && c.j !== author) return false;
      if (kind === 'argued' && !c.a) return false;
      if (kind === 'summary' && c.a) return false;
      if (won && c.w !== won) return false;
      const d = dissenting(c.v);
      if (vote === 'unanimous' && d !== 0) return false;
      if (vote === 'divided' && !d) return false;
      if (vote === 'close' && (d === null || d < 4)) return false;
      if (discussed && !c.x) return false;
      if (words.length === 0) return true;
      const text = `${c.n} ${c.k ?? ''} ${c.c ?? ''} ${c.j ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [all, q, term, author, kind, won, vote, discussed]);

  const active = q || term || author || kind || won || vote || discussed;
  const reset = () => {
    setQ('');
    setTerm('');
    setAuthor('');
    setKind('');
    setWon('');
    setVote('');
    setDiscussed(false);
    setShown(pageSize());
  };
  const set =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setShown(pageSize());
    };

  return (
    <div>
      <form class="explorer-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <div class="explorer-query">
          <label for="case-q" class="visually-hidden">
            Search decisions
          </label>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input
            id="case-q"
            type="search"
            value={q}
            placeholder="Case or Justice"
            onInput={(e) => set(setQ)(e.currentTarget.value)}
          />
        </div>
        <div class="explorer-filters" role="group" aria-label="Filters">
          <label for="case-term" class="visually-hidden">
            Term
          </label>
          <select
            id="case-term"
            value={term}
            class={term ? 'is-set' : ''}
            onChange={(e) => set(setTerm)(e.currentTarget.value)}
          >
            <option value="">All terms</option>
            {terms.map((t) => (
              <option value={String(t)}>{termName(t)}</option>
            ))}
          </select>
          <label for="case-author" class="visually-hidden">
            Opinion by
          </label>
          <select
            id="case-author"
            value={author}
            class={author ? 'is-set' : ''}
            onChange={(e) => set(setAuthor)(e.currentTarget.value)}
          >
            <option value="">Any author</option>
            {authors.map((a) => (
              <option value={a}>{a === 'Per Curiam' ? 'Per curiam (unsigned)' : a}</option>
            ))}
          </select>
          <label for="case-kind" class="visually-hidden">
            Argued
          </label>
          <select
            id="case-kind"
            value={kind}
            class={kind ? 'is-set' : ''}
            onChange={(e) => set(setKind)(e.currentTarget.value as Kind)}
          >
            <option value="">Argued or not</option>
            <option value="argued">Argued cases</option>
            <option value="summary">Decided without argument</option>
          </select>
          {outcomes && (
            <>
              <label for="case-won" class="visually-hidden">
                Who won
              </label>
              <select
                id="case-won"
                value={won}
                class={won ? 'is-set' : ''}
                onChange={(e) => set(setWon)(e.currentTarget.value as Won)}
              >
                <option value="">Any outcome</option>
                <option value="p">Petitioner won</option>
                <option value="r">Respondent won</option>
              </select>
              <label for="case-vote" class="visually-hidden">
                Vote
              </label>
              <select
                id="case-vote"
                value={vote}
                class={vote ? 'is-set' : ''}
                onChange={(e) => set(setVote)(e.currentTarget.value as Vote)}
              >
                <option value="">Any vote</option>
                <option value="unanimous">Unanimous</option>
                <option value="divided">Divided</option>
                <option value="close">5–4 or closer</option>
              </select>
            </>
          )}
          <button
            type="button"
            class="filter-toggle"
            aria-pressed={discussed}
            onClick={() => set(setDiscussed)(!discussed)}
          >
            Has a discussion
          </button>
          {active && (
            <button type="button" class="link-button clear-filters" onClick={reset}>
              Clear
            </button>
          )}
        </div>
      </form>

      <p class="small muted" aria-live="polite">
        {rows === null && !failed
          ? 'Loading every decision…'
          : `${hits.length.toLocaleString()} decision${hits.length === 1 ? '' : 's'}${term ? ` in the ${termName(Number(term))}` : ''}`}
        {failed && ' Showing the latest decisions only; the full list didn’t load.'}
      </p>

      {hits.length === 0 ? (
        <p class="muted">
          No decisions match.{' '}
          <button type="button" class="link-button" onClick={reset}>
            Clear filters
          </button>
        </p>
      ) : (
        <div class="panel">
          <ul class={`list case-list trimmable${mounted ? ' is-live' : ''}`}>
            {hits.slice(0, shown).map((c) => (
              <li key={c.i}>
                <p class="meta">
                  Decided {formatDate(c.d)}
                  {c.k && (
                    <>
                      {' · '}
                      <a href={docketUrl(c.k)} rel="noopener">
                        No. {c.k}
                      </a>
                    </>
                  )}
                  {c.c && <> · {c.c}</>}
                </p>
                <p class="case-name">
                  <a href={scotusCaseHref(c.i)}>{c.n}</a>
                  {c.x && <span class="chip">Discussion</span>}
                </p>
                {tags(c).length > 0 && <p class="small muted">{tags(c).join(' · ')}</p>}
              </li>
            ))}
          </ul>
          {hits.length > shown && (
            <button type="button" onClick={() => setShown(shown + pageSize())}>
              Show more ({(hits.length - shown).toLocaleString()} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

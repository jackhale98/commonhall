import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { billLabel } from '@civic/congress-client/ids';
import { DEMO, hasSupabase } from '../lib/config';
import { rpc } from '../lib/rest';
import { href } from '../lib/paths';
import { prepare, search, type Searchable } from '../lib/search';

const KIND_LABEL: Record<string, string> = {
  page: 'Page',
  state: 'State',
  member: 'Congress',
  councilor: 'Boston',
  committee: 'Committee',
  discussion: 'Discussion',
  bill: 'Bill',
  'state-bill': 'State bill',
  order: 'Exec. order',
  case: 'Court',
  hearing: 'Hearing',
  nomination: 'Nominee',
  matter: 'Boston',
};

/** Best-matching bills from the database (the instant index holds only notable bills). */
async function liveBills(q: string): Promise<Searchable[]> {
  const rows = await rpc<
    { congress: number; bill_type: string; number: number; short_title: string | null; title: string }[]
  >('search_bills', { q, max_results: 5 }, { select: 'congress,bill_type,number,short_title,title' });
  return rows.map((b) => ({
    k: 'bill',
    t:
      (b.short_title ?? b.title).length > 110
        ? `${(b.short_title ?? b.title).slice(0, 109)}…`
        : (b.short_title ?? b.title),
    s: billLabel(b.bill_type, b.number),
    h: href(`bills/${b.congress}/${b.bill_type}/${b.number}/`),
  }));
}

let indexPromise: Promise<ReturnType<typeof prepare<Searchable>>> | undefined;
function loadIndex() {
  indexPromise ??= fetch(href('search-index.json'))
    .then((r) => (r.ok ? (r.json() as Promise<Searchable[]>) : []))
    .then((items) => prepare(items))
    .catch(() => {
      indexPromise = undefined;
      return [];
    });
  return indexPromise;
}

const QUICK: Searchable[] = [
  ...(DEMO ? [] : [{ k: 'page', t: 'Find my representatives', s: 'From your address', h: href('#reps-h') }]),
  { k: 'page', t: 'Bills', s: 'Search and filter every bill', h: href('bills/') },
  { k: 'page', t: 'Votes', s: 'Every House and Senate roll call', h: href('votes/') },
  { k: 'page', t: 'Massachusetts', s: 'Legislature and state bills', h: href('states/ma/') },
  { k: 'page', t: 'Boston City Council', s: 'Councilors, district map, meetings', h: href('boston/') },
  { k: 'page', t: 'Discussions', s: 'Have your say', h: href('discussions/') },
];

/**
 * Header search: a button that opens a dialog with instant results across people,
 * places, discussions and notable bills. The index loads on first open; "/" or
 * Ctrl/Cmd+K open it from anywhere. Other search boxes on a page (the home page
 * hero) open it by dispatching `open-search` on `document`, with the text typed so far.
 */
export default function SearchPalette() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState<ReturnType<typeof prepare<Searchable>> | null>(null);
  const [active, setActive] = useState(0);
  const [live, setLive] = useState<{ q: string; items: Searchable[] }>({ q: '', items: [] });

  // Ask the database for matching bills once typing pauses.
  useEffect(() => {
    const term = q.trim();
    if (!hasSupabase || term.length < 2) return;
    const timer = setTimeout(() => {
      liveBills(term)
        .then((items) => setLive({ q: term, items }))
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const open = () => {
    if (!dialog.current || dialog.current.open) return;
    dialog.current.showModal();
    input.current?.focus();
    loadIndex().then(setIndex);
  };

  useEffect(() => {
    const onOpen = (e: Event) => {
      const text = (e as CustomEvent<{ q?: string }>).detail?.q;
      if (text) setQ(text);
      open();
    };
    document.addEventListener('open-search', onOpen);
    document.documentElement.dataset.searchReady = '';
    return () => document.removeEventListener('open-search', onOpen);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        open();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const term = q.trim();
    if (!term) return QUICK;
    const hits = index ? search(index, term, 8) : [];
    const seen = new Set(hits.map((h) => h.h));
    const bills =
      live.q === term ? live.items.filter((b) => !seen.has(b.h)).slice(0, Math.max(3, 10 - hits.length)) : [];
    return [
      ...hits,
      ...bills,
      {
        k: 'all',
        t: `Search all bills for “${term}”`,
        s: 'Full-text search',
        h: `${href('bills/')}?q=${encodeURIComponent(term)}`,
      },
    ];
  }, [q, index, live]);

  useEffect(() => setActive(0), [q]);

  const go = (h: string) => {
    dialog.current?.close();
    window.location.href = h;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // A search input clears itself on Escape instead of closing the dialog; close it here.
    if (e.key === 'Escape') {
      e.preventDefault();
      dialog.current?.close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      go(results[active]!.h);
    }
  };

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <>
      <button type="button" class="search-trigger" onClick={open} aria-label="Search" aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
        <span class="search-trigger-label">Search bills, people, places</span>
        <kbd class="search-kbd">{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <dialog
        ref={dialog}
        class="palette"
        aria-label="Search"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        onClose={() => setQ('')}
      >
        <div class="palette-box">
          <div class="palette-input">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
              <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
            <input
              ref={input}
              type="search"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-results"
              aria-activedescendant={results[active] ? `palette-opt-${active}` : undefined}
              aria-autocomplete="list"
              placeholder="Search everything"
              value={q}
              onInput={(e) => setQ(e.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
            <button
              type="button"
              class="palette-close"
              aria-label="Close search"
              onClick={() => dialog.current?.close()}
            >
              <span class="close-touch">Cancel</span>
              <span class="close-keys">Esc</span>
            </button>
          </div>
          <p class="palette-heading">{q.trim() ? 'Results' : 'Jump to'}</p>
          <ul id="palette-results" role="listbox" class="palette-results">
            {results.map((r, i) => (
              <li
                id={`palette-opt-${i}`}
                role="option"
                aria-selected={i === active}
                class={i === active ? 'is-active' : ''}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.h)}
              >
                <span class={`palette-kind kind-${r.k}`}>{r.k === 'all' ? 'All bills' : KIND_LABEL[r.k]}</span>
                <span class="palette-text">
                  <span class="palette-title">{r.t}</span>
                  <span class="palette-sub">{r.s}</span>
                </span>
              </li>
            ))}
          </ul>
          <p class="palette-foot">
            <kbd>↑</kbd> <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close
          </p>
        </div>
      </dialog>
    </>
  );
}

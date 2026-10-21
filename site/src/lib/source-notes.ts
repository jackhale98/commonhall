/**
 * Refreshes every SourceNote on the page from the database: one request for each of
 * public.data_status and public.data_coverage, kept for five minutes in this tab so
 * browsing from page to page doesn't repeat them. The note keeps its build-time text
 * when the database can't be reached.
 */
import { noteState, noteText, type CoverageRow } from './freshness';
import { rpc } from './rest';
import type { StatusRow } from './status';

const CACHE_KEY = 'source-notes';
const CACHE_MS = 5 * 60_000;

interface Snapshot {
  at: number;
  status: StatusRow[];
  coverage: CoverageRow[];
}

function cached(): Snapshot | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    const snap = raw ? (JSON.parse(raw) as Snapshot) : null;
    return snap && Date.now() - snap.at < CACHE_MS ? snap : null;
  } catch {
    return null;
  }
}

async function snapshot(): Promise<Snapshot> {
  const hit = cached();
  if (hit) return hit;
  const [status, coverage] = await Promise.all([
    rpc<StatusRow[]>('data_status', {}),
    rpc<CoverageRow[]>('data_coverage', {}).catch(() => [] as CoverageRow[]),
  ]);
  const snap = { at: Date.now(), status: status ?? [], coverage: coverage ?? [] };
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(snap));
  } catch {
    // Storage unavailable (private mode): fetch again on the next page.
  }
  return snap;
}

let started = false;

export async function refreshSourceNotes(): Promise<void> {
  if (started) return;
  started = true;
  const notes = [...document.querySelectorAll<HTMLElement>('.source-note[data-jobs]')];
  if (!notes.length) return;
  let snap: Snapshot;
  try {
    snap = await snapshot();
  } catch {
    return;
  }
  if (!snap.status.length) return;
  const now = new Date();
  for (const note of notes) {
    const jobs = (note.dataset.jobs ?? '').split(' ').filter(Boolean);
    const state = noteState(snap.status, snap.coverage, jobs, note.dataset.coverage, now);
    const text = noteText(state, note.dataset.source ?? '', note.dataset.what ?? 'records', now, true);
    const loading = note.querySelector<HTMLElement>('.source-loading');
    const fresh = note.querySelector<HTMLElement>('.source-fresh');
    const status = note.querySelector<HTMLElement>('.source-status');
    if (loading) {
      loading.textContent = text.loading ?? '';
      loading.hidden = !text.loading;
    }
    if (fresh) {
      fresh.textContent = text.fresh;
      if (text.exact) fresh.title = text.exact;
    }
    if (status) status.hidden = !text.delayed;
    note.classList.toggle('is-delayed', text.delayed);
  }
}

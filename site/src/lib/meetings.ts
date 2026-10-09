import type { CommitteeMeeting } from './committees';

export type MeetingKind = 'hearing' | 'markup' | 'other';

/** Hearings take testimony; markups amend and vote on bills; the rest are business meetings and the like. */
export function meetingKind(m: Pick<CommitteeMeeting, 'meeting_type'>): MeetingKind {
  const t = m.meeting_type ?? '';
  if (/markup/i.test(t)) return 'markup';
  if (/hearing/i.test(t)) return 'hearing';
  return 'other';
}

export const KIND_LABEL: Record<MeetingKind, string> = {
  hearing: 'Hearings',
  markup: 'Markups',
  other: 'Other meetings',
};
export const KIND_FILL: Record<MeetingKind, string> = {
  hearing: 'fill-hearing',
  markup: 'fill-markup',
  other: 'fill-other-meeting',
};
export const KINDS: MeetingKind[] = ['hearing', 'markup', 'other'];

export const isCanceled = (m: Pick<CommitteeMeeting, 'status'>) => /cancel|postpon/i.test(m.status ?? '');

/** Rows stored before the sync parsed field-hearing addresses hold them as JSON text. */
function cleanLocation(location: string | null): string | null {
  if (!location || !location.includes('{')) return location;
  return location.replace(/\{[^}]*\}/, (json) => {
    try {
      const a = JSON.parse(json) as Record<string, unknown>;
      return [a.building_name, a.city, a.state].filter((x) => typeof x === 'string' && x).join(', ');
    } catch {
      return '';
    }
  });
}

/** The trimmed shape lists and the explorer use. */
export function meetingRow(m: CommitteeMeeting) {
  return {
    id: m.id,
    date: m.date,
    title: m.title,
    kind: meetingKind(m),
    type: m.meeting_type,
    status: m.status,
    location: cleanLocation(m.location),
    committees: m.committee_codes,
    committeeNames: m.committee_names,
    witnesses: m.witnesses.map((w) => w.name),
    video: m.video_url,
    url: m.url,
  };
}

/** Monday (UTC) of the week containing `iso`, as YYYY-MM-DD. */
export function weekOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

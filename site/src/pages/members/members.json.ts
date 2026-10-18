import { safeUrl } from '@civic/congress-client/safe-url';
import { congressPortrait } from '../../components/MemberPhoto';
import { loadMembers } from '../../lib/build-data';

/**
 * Every current member, for the search on /members/ (loaded by the browser). One array
 * per member, by name: [bioguide ID, name, party letter, chamber, state, district (null
 * for senators), photo (null when it is the unitedstates/images portrait), seat rank
 * within the state (senators by name, then districts)].
 */
export async function GET() {
  const sortKey = (m: { sort_name: string | null; name: string }) => m.sort_name ?? m.name;
  const members = [...(await loadMembers()).values()]
    .filter((m) => m.current && m.state)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const seatRank = new Map(
    [...members]
      .sort(
        (a, b) =>
          (a.chamber === 'senate' ? 0 : 1) - (b.chamber === 'senate' ? 0 : 1) ||
          (a.district ?? 0) - (b.district ?? 0) ||
          sortKey(a).localeCompare(sortKey(b)),
      )
      .map((m, i) => [m.bioguide_id, i]),
  );
  const rows = members.map((m) => {
    const photo = safeUrl(m.photo_url);
    return [
      m.bioguide_id,
      m.name,
      (m.party ?? '').charAt(0),
      m.chamber,
      m.state,
      m.chamber === 'house' ? (m.district ?? 0) : null,
      photo === congressPortrait(m.bioguide_id) ? null : photo,
      seatRank.get(m.bioguide_id) ?? 0,
    ];
  });
  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
}

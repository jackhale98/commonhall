import { memberTag, partyClass, partyLabel } from '../lib/format';
import { memberHref } from '../lib/paths';
import type { Member } from '../lib/types';

type M = Pick<Member, 'bioguide_id' | 'name' | 'party' | 'state' | 'district' | 'chamber'>;

/** Name link with a small party marker: "Jodey Arrington ● R-TX-19". */
export default function MemberChip({ member }: { member: M }) {
  return (
    <span class="member-chip">
      <a href={memberHref(member.bioguide_id)}>{member.name}</a>{' '}
      <span class={`party ${partyClass(member.party)}`} title={partyLabel(member.party)}>
        {memberTag(member)}
      </span>
    </span>
  );
}

export type VotePosition = 'yea' | 'nay' | 'present' | 'not_voting';

/**
 * Normalise the many spellings used by the House Clerk, Congress.gov and the
 * Senate ("Aye", "Yea", "No", "Nay", "Guilty", "Not Guilty", "Present",
 * "Not Voting", …) to the four positions stored in `vote_positions`.
 */
export function normalizePosition(raw: string | null | undefined): VotePosition {
  const value = (raw ?? '').trim().toLowerCase();
  switch (value) {
    case 'yea':
    case 'aye':
    case 'yes':
    case 'guilty':
      return 'yea';
    case 'nay':
    case 'no':
    case 'not guilty':
      return 'nay';
    case 'present':
    case 'present, giving live pair':
      return 'present';
    default:
      return 'not_voting';
  }
}

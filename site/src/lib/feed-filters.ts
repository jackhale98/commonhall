/** The feed's Legislators view, narrowed to one level of government. */

export type Level = '' | 'federal' | 'state' | 'local';

export const LEVELS: [Level, string][] = [
  ['', 'All levels'],
  ['federal', 'Federal'],
  ['state', 'State'],
  ['local', 'Local'],
];

/** Each level's legislators, as followed people (target) or as the actor on something followed. */
const LEVEL_TYPES: Record<Exclude<Level, ''>, string> = {
  federal: 'member',
  state: 'state_legislator',
  local: 'local_official',
};

/** A PostgREST `or` filter for the Legislators view at one level of government, or all of them. */
export function legislatorFilter(level: Level): string {
  const types = level ? [LEVEL_TYPES[level]] : Object.values(LEVEL_TYPES);
  return types.map((t) => `target_type.eq.${t},and(reason.eq.legislator,member_type.eq.${t})`).join(',');
}

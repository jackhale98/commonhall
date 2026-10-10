/** The cities we cover, for labels and links shared across pages. */
export interface City {
  key: string;
  name: string;
  state: string;
  /** Site path of the city's pages, relative to the site root. */
  path: string;
  council: string;
  atLarge: number;
}

export const CITIES: Record<string, City> = {
  boston: { key: 'boston', name: 'Boston', state: 'MA', path: 'boston/', council: 'Boston City Council', atLarge: 4 },
  worcester: {
    key: 'worcester',
    name: 'Worcester',
    state: 'MA',
    path: 'worcester/',
    council: 'Worcester City Council',
    atLarge: 6,
  },
};

/** The city an id belongs to ("boston-p324", "worcester-khrystian-king"). */
export function cityOf(id: string): City | undefined {
  return CITIES[id.split('-')[0] ?? ''];
}

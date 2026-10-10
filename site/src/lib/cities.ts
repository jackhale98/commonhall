/**
 * The cities we cover. Each city's pages are one shared set (states/{state}/{city}/…)
 * filled from this registry and from whatever data the city has: a tab appears when
 * there is something behind it. Adding a city means a sync for its data and an entry
 * here; no page code.
 *
 * The key ("ma-boston") is the state and the city's slug. It is the `city` value in
 * the database, the prefix of every id that belongs to the city, and the
 * jurisdiction of its discussions, so two towns with one name in different states
 * can't collide.
 */

export interface Source {
  label: string;
  url: string;
  /** How often we check it ("every 15 minutes", "weekly"). */
  cadence?: string;
}

export interface City {
  key: string;
  state: string;
  slug: string;
  name: string;
  council: string;
  /** Council districts (0 when every seat is citywide). */
  districts: number;
  atLarge: number;
  /** What the city calls a district: "District" (the default) or "Ward". */
  districtWord?: string;
  /**
   * False when the city's district shapes aren't published (Bristol's are a PDF street
   * index): no district map, and an address in the city finds the whole council (its
   * whole boundary is loaded as district 0). Default true.
   */
  districtMap?: boolean;
  /** What a full council meeting is called in meeting lists: "City Council" (the default), "Common Council". */
  councilBody?: string;
  /** What the city calls a committee session: "hearing" (Boston) or "meeting". */
  committeeSession: 'hearing' | 'meeting';
  /** One line under the name on the Overview. */
  lede: string;
  /** What we cover, for the state's Local tab. */
  summary: string;
  /** Where each kind of data comes from, for the source line under it. */
  sources: {
    people: Source;
    meetings: Source;
    committees?: Source;
    legislation?: Source;
    /** 311 requests (summaries). */
    requests?: Source;
    /** Zoning board cases, and where the board publishes hearings and decisions. */
    zoning?: Source & { board: string };
  };
  /** How a council matter is cited: "Docket #" (Boston), "Item " (Worcester's agenda items). */
  docketPrefix?: string;
  /** The link to a matter's own record: "Full record on Legistar", "The agenda". */
  recordLabel?: string;
  /** The Council tab's heading for its matters. */
  legislationTitle?: string;
  /** Committee sessions put their subject in the location field (Boston's Legistar), so it isn't a place. */
  locationIsSubject?: boolean;
  /** The city's Legistar client name, for links to matters we don't keep. */
  legistar?: string;
}

export const CITY_LIST: City[] = [
  {
    key: 'ma-boston',
    state: 'MA',
    slug: 'boston',
    name: 'Boston',
    council: 'Boston City Council',
    districts: 9,
    atLarge: 4,
    committeeSession: 'hearing',
    lede: 'Thirteen city councilors: one for each of nine districts and four elected citywide.',
    summary: 'City Council, committee hearings, zoning appeals and the budget',
    sources: {
      people: { label: 'Boston’s Legistar', url: 'https://boston.legistar.com/', cadence: 'weekly' },
      meetings: {
        label: 'Boston’s Legistar',
        url: 'https://boston.legistar.com/Calendar.aspx',
        cadence: 'every 15 minutes',
      },
      legislation: { label: 'Boston’s Legistar', url: 'https://boston.legistar.com/', cadence: 'every 15 minutes' },
      requests: {
        label: '311 requests on Analyze Boston',
        url: 'https://data.boston.gov/dataset/311-service-requests',
        cadence: 'daily',
      },
      zoning: {
        label: 'the Zoning Board of Appeal tracker on Analyze Boston',
        url: 'https://data.boston.gov/dataset/zoning-board-of-appeal-tracker',
        cadence: 'daily',
        board: 'https://www.boston.gov/departments/inspectional-services/zoning-board-appeal',
      },
    },
    locationIsSubject: true,
    legistar: 'boston',
    recordLabel: 'Full record on Legistar',
  },
  {
    key: 'ma-worcester',
    state: 'MA',
    slug: 'worcester',
    name: 'Worcester',
    council: 'Worcester City Council',
    districts: 5,
    atLarge: 6,
    committeeSession: 'meeting',
    lede: 'Eleven city councilors: one for each of five districts and six elected citywide, including the mayor.',
    summary: 'City Council, committees and meetings, and the budget',
    sources: {
      people: {
        label: 'the city’s website',
        url: 'https://www.worcesterma.gov/city-council/councilors',
        cadence: 'weekly',
      },
      meetings: {
        label: 'the city’s PrimeGov portal',
        url: 'https://worcesterma.primegov.com/public/portal',
        cadence: 'hourly',
      },
      committees: {
        label: 'the city’s website',
        url: 'https://www.worcesterma.gov/city-council/standing-committees',
        cadence: 'weekly',
      },
      legislation: {
        label: 'council agendas on PrimeGov',
        url: 'https://worcesterma.primegov.com/public/portal',
        cadence: 'daily',
      },
    },
    docketPrefix: 'Item ',
    recordLabel: 'The agenda',
    legislationTitle: 'Orders, petitions and communications',
  },
  {
    key: 'ct-bristol',
    state: 'CT',
    slug: 'bristol',
    name: 'Bristol',
    council: 'Bristol City Council',
    districts: 3,
    atLarge: 0,
    // The district map is a PDF street index, not shapes: an address finds the whole council.
    districtMap: false,
    committeeSession: 'meeting',
    lede: 'The mayor and six city councilors, two from each of three districts.',
    summary: 'City Council, its committees and their agendas',
    sources: {
      people: {
        label: 'the city’s website',
        url: 'https://www.bristolct.gov/1030/City-Council-Members',
        cadence: 'weekly',
      },
      meetings: {
        label: 'the city’s CivicClerk portal',
        url: 'https://bristolct.portal.civicclerk.com/',
        cadence: 'hourly',
      },
      committees: {
        label: 'the city’s CivicClerk portal',
        url: 'https://bristolct.portal.civicclerk.com/',
        cadence: 'hourly',
      },
      legislation: {
        label: 'council and committee agendas on CivicClerk',
        url: 'https://bristolct.portal.civicclerk.com/',
        cadence: 'hourly',
      },
    },
    docketPrefix: 'Item ',
    recordLabel: 'The meeting on CivicClerk',
    legislationTitle: 'Agenda items',
  },
  {
    key: 'ct-middletown',
    state: 'CT',
    slug: 'middletown',
    name: 'Middletown',
    council: 'Middletown Common Council',
    districts: 0,
    atLarge: 12,
    committeeSession: 'meeting',
    councilBody: 'Common Council',
    lede: 'Twelve council members, all elected citywide; the mayor presides.',
    summary: 'Common Council, its resolutions and ordinances, and 311 requests',
    sources: {
      people: { label: 'the city’s website', url: 'https://www.middletownct.gov/458/Common-Council', cadence: 'daily' },
      meetings: {
        label: 'the city’s Agenda Center',
        url: 'https://www.middletownct.gov/AgendaCenter',
        cadence: 'daily',
      },
      legislation: {
        label: 'Common Council agendas in the city’s Agenda Center',
        url: 'https://www.middletownct.gov/AgendaCenter',
        cadence: 'daily',
      },
      requests: {
        label: 'requests on SeeClickFix',
        url: 'https://seeclickfix.com/middletown',
        cadence: 'daily',
      },
    },
    // Items are cited as the agenda gives them: "Resolution No. 81-26" or "Item 11A, Oct 5, 2026".
    docketPrefix: '',
    recordLabel: 'The agenda',
    legislationTitle: 'Resolutions, ordinances and appropriations',
  },
];

/** "District 3", "Ward 3". */
export const districtName = (city: Pick<City, 'districtWord'> | undefined, n: number | string) =>
  `${city?.districtWord ?? 'District'} ${n}`;

export const CITIES: Record<string, City> = Object.fromEntries(CITY_LIST.map((c) => [c.key, c]));

/** The city an id belongs to ("ma-boston-p324", "ma-worcester-gary-rosen"), by its longest matching key. */
export function cityOf(id: string): City | undefined {
  return [...CITY_LIST].sort((a, b) => b.key.length - a.key.length).find((c) => id.startsWith(`${c.key}-`));
}

/** The part of an id after its city key ("p324", "gary-rosen"). */
export function idWithinCity(id: string): string {
  const city = cityOf(id);
  return city ? id.slice(city.key.length + 1) : id;
}

/** Cities in a state, in registry order. */
export const citiesIn = (state: string) => CITY_LIST.filter((c) => c.state === state.toUpperCase());

/** "Find your councilor" wording: "District 4 and the six at-large councilors". */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const numberWord = (n: number) => WORDS[n] ?? String(n);

/** "Docket #1829" or "Item 12a, Oct 6, 2026": how a council matter is cited in its city. */
export function matterLabel(m: { id: string; file_number: string | null; matter_id: number }): string {
  if (!m.file_number) return `Matter ${m.matter_id}`;
  return `${cityOf(m.id)?.docketPrefix ?? 'Docket #'}${m.file_number}`;
}

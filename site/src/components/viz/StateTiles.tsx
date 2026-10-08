// prettier-ignore
/** Tile-grid map of the 50 states and DC: equal squares placed roughly where each state is. */
const GRID: Record<string, [number, number]> = {
  AK: [0, 0], ME: [11, 0],
  WI: [6, 1], VT: [10, 1], NH: [11, 1],
  WA: [1, 2], ID: [2, 2], MT: [3, 2], ND: [4, 2], MN: [5, 2], IL: [6, 2], MI: [7, 2], NY: [9, 2], MA: [10, 2],
  OR: [1, 3], NV: [2, 3], WY: [3, 3], SD: [4, 3], IA: [5, 3], IN: [6, 3], OH: [7, 3], PA: [8, 3], NJ: [9, 3], CT: [10, 3], RI: [11, 3],
  CA: [1, 4], UT: [2, 4], CO: [3, 4], NE: [4, 4], MO: [5, 4], KY: [6, 4], WV: [7, 4], VA: [8, 4], MD: [9, 4], DE: [10, 4],
  AZ: [2, 5], NM: [3, 5], KS: [4, 5], AR: [5, 5], TN: [6, 5], NC: [7, 5], SC: [8, 5], DC: [9, 5],
  OK: [4, 6], LA: [5, 6], MS: [6, 6], AL: [7, 6], GA: [8, 6],
  HI: [0, 7], TX: [4, 7], FL: [9, 7],
};

export interface Tile {
  code: string;
  name: string;
  href: string;
  /** Small number under the code (e.g. House seats). */
  note?: string;
  featured?: boolean;
}

export default function StateTiles({ tiles, label }: { tiles: Tile[]; label: string }) {
  return (
    <ul class="state-tiles" aria-label={label}>
      {tiles
        .filter((t) => GRID[t.code])
        .map((t) => {
          const [x, y] = GRID[t.code]!;
          return (
            <li style={{ gridColumn: x + 1, gridRow: y + 1 }}>
              <a href={t.href} class={t.featured ? 'tile featured' : 'tile'} title={t.name} aria-label={t.name}>
                <span class="tile-code">{t.code}</span>
                {t.note && <span class="tile-note">{t.note}</span>}
              </a>
            </li>
          );
        })}
    </ul>
  );
}

export interface SeatGroup {
  label: string;
  seats: number;
  tone: string;
}

interface Props {
  groups: SeatGroup[];
  title: string;
}

interface Seat {
  x: number;
  y: number;
  angle: number;
}

/** Seat positions for a parliament chart: concentric half-rings, seats spread by angle. */
export function seatLayout(total: number): { seats: Seat[]; radius: number } {
  if (total <= 0) return { seats: [], radius: 0 };
  const rows = Math.max(2, Math.round(Math.sqrt(total / 3.5)));
  const inner = 0.42;
  const radii = Array.from({ length: rows }, (_, i) => inner + ((1 - inner) * i) / (rows - 1));
  const sum = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.max(1, Math.round((total * r) / sum)));
  counts[rows - 1]! += total - counts.reduce((a, b) => a + b, 0);
  const seats: Seat[] = [];
  radii.forEach((r, i) => {
    const n = counts[i]!;
    for (let j = 0; j < n; j++) {
      const angle = n === 1 ? Math.PI / 2 : Math.PI - (Math.PI * j) / (n - 1);
      seats.push({ x: Math.cos(angle) * r, y: -Math.sin(angle) * r, angle });
    }
  });
  seats.sort((a, b) => b.angle - a.angle);
  return { seats, radius: Math.min(0.42 * ((1 - inner) / (rows - 1)), 0.05) };
}

/** Parliament-style chart of a chamber's seats by party (left to right in the order given). */
export default function Hemicycle({ groups, title }: Props) {
  const total = groups.reduce((n, g) => n + g.seats, 0);
  const { seats, radius } = seatLayout(total);
  const tones: string[] = [];
  for (const g of groups) for (let i = 0; i < g.seats; i++) tones.push(g.tone);
  const summary = `${title}: ${groups.map((g) => `${g.label} ${g.seats}`).join(', ')}`;
  return (
    <figure class="hemicycle">
      <svg viewBox="-1.06 -1.06 2.12 1.12" role="img" aria-label={summary}>
        {seats.map((s, i) => (
          <circle cx={s.x.toFixed(4)} cy={s.y.toFixed(4)} r={radius.toFixed(4)} class={tones[i]} />
        ))}
        <text x="0" y="-0.06" text-anchor="middle" class="hemicycle-total">
          {total}
        </text>
      </svg>
      <figcaption>
        <strong>{title}</strong>
        <ul class="legend">
          {groups
            .filter((g) => g.seats > 0)
            .map((g) => (
              <li>
                <span class={`swatch ${g.tone}`} />
                {g.label} <strong>{g.seats}</strong>
              </li>
            ))}
        </ul>
      </figcaption>
    </figure>
  );
}

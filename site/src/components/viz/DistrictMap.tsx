export interface DistrictFeature {
  district: number;
  /** GeoJSON MultiPolygon or Polygon geometry, as a string or object. */
  geojson: string | { type: string; coordinates: unknown };
  href?: string;
  /** Tooltip / accessible name, e.g. "District 7: Miniard Culpepper". */
  title: string;
}

type Ring = [number, number][];

function polygons(geo: DistrictFeature['geojson']): Ring[][] {
  const g = (typeof geo === 'string' ? JSON.parse(geo) : geo) as { type: string; coordinates: unknown };
  if (g.type === 'Polygon') return [g.coordinates as Ring[]];
  if (g.type === 'MultiPolygon') return g.coordinates as Ring[][];
  return [];
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return a / 2;
}

function centroid(ring: Ring): [number, number] {
  let x = 0;
  let y = 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
    x += (ring[j]![0] + ring[i]![0]) * f;
    y += (ring[j]![1] + ring[i]![1]) * f;
    a += f;
  }
  return a === 0 ? ring[0]! : [x / (3 * a), y / (3 * a)];
}

interface Props {
  features: DistrictFeature[];
  label: string;
  /** District to emphasise (e.g. the visitor's or the councilor's). */
  highlight?: number | null;
  width?: number;
}

/**
 * Council districts as an SVG map, projected at build time (equirectangular,
 * corrected for latitude). Each district links to its councilor.
 */
export default function DistrictMap({ features, label, highlight = null, width = 480 }: Props) {
  const shapes = features.map((f) => ({ f, polys: polygons(f.geojson) }));
  const points = shapes.flatMap((s) => s.polys.flat(2) as unknown as [number, number][]);
  if (points.length === 0) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const [minLon, maxLon, minLat, maxLat] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const w = (maxLon - minLon) * k;
  const h = maxLat - minLat;
  const scale = width / w;
  const height = Math.round(h * scale);
  const project = ([lon, lat]: [number, number]): [number, number] => [
    (lon - minLon) * k * scale,
    (maxLat - lat) * scale,
  ];
  const path = (polys: Ring[][]) =>
    polys
      .map((poly) =>
        poly
          .map(
            (ring) =>
              `M${ring
                .map((p) =>
                  project(p)
                    .map((n) => n.toFixed(1))
                    .join(','),
                )
                .join('L')}Z`,
          )
          .join(''),
      )
      .join('');

  return (
    <svg class="district-map" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={label}>
      {shapes.map(({ f, polys }) => {
        const outer = polys.map((p) => p[0]!).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0]!;
        const [cx, cy] = project(centroid(outer));
        const shape = (
          <>
            <title>{f.title}</title>
            <path
              d={path(polys)}
              class={`district dist-${f.district}${highlight === f.district ? ' is-highlight' : ''}`}
            />
            <text
              x={cx.toFixed(1)}
              y={cy.toFixed(1)}
              class="district-label"
              text-anchor="middle"
              dominant-baseline="central"
            >
              {f.district}
            </text>
          </>
        );
        return f.href ? (
          <a href={f.href} aria-label={f.title}>
            {shape}
          </a>
        ) : (
          <g>{shape}</g>
        );
      })}
    </svg>
  );
}

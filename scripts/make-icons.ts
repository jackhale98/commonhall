/**
 * The home-screen and app icons (site/public/apple-touch-icon.png, icon-512.png), drawn
 * from the logo's geometry (favicon.svg: seven seats on an arc around the gold "you").
 *
 * The mark isn't centred on its bounding box: the arc opens to the right and the eye reads
 * the gold dot as the centre, so a box-centred mark looks pushed left (and a dot-centred
 * one pushed right). It is placed halfway between the two.
 *
 *   npx tsx scripts/make-icons.ts
 */
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SEATS = [
  [25.08, 6.94],
  [17.06, 4.54],
  [9.54, 8.21],
  [6.5, 16],
  [9.54, 23.79],
  [17.06, 27.46],
  [25.08, 25.06],
];
const YOU = [18, 16];
/** The mark's grid (32 units) as a share of the icon. */
const SCALE = 0.64;
/** Where the mark's centre sits on the grid: between its bounding box (15.8) and the gold dot (18). */
const CENTRE_X = 16.9;

function iconSvg(size: number): string {
  const k = (size * SCALE) / 32;
  const x = (u: number) => size / 2 + (u - CENTRE_X) * k;
  const y = (u: number) => size / 2 + (u - 16) * k;
  const dot = (cx: number, cy: number, r: number, fill: string) =>
    `<circle cx="${x(cx).toFixed(2)}" cy="${y(cy).toFixed(2)}" r="${(r * k).toFixed(2)}" fill="${fill}"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`,
    `<rect width="${size}" height="${size}" fill="#5b4cf0"/>`,
    ...SEATS.map(([cx, cy]) => dot(cx!, cy!, 2.7, '#ffffff')),
    dot(YOU[0]!, YOU[1]!, 3.4, '#f4b83f'),
    '</svg>',
  ].join('');
}

const out = (name: string) => fileURLToPath(new URL(`../site/public/${name}`, import.meta.url));
for (const [name, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-512.png', 512],
] as const) {
  await sharp(Buffer.from(iconSvg(size)))
    .png({ compressionLevel: 9 })
    .toFile(out(name));
  console.log(`${name}: ${size}×${size}`);
}

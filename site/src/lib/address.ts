/**
 * City, state and ZIP from a matched address, for the saved-location label
 * ("1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500" → "Washington, DC 20500").
 * The street is never kept; null when the street can't be told apart from the place.
 * The database applies the same rule to every write (private.area_label).
 */
export function areaLabel(address: string | null | undefined): string | null {
  if (!address) return null;
  let parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 4 || (parts.length >= 2 && /^\d/.test(parts[0]!))) parts = parts.slice(1);
  const title = (s: string) => s.toLowerCase().replace(/(^|[\s'-])\S/g, (c) => c.toUpperCase());
  if (parts.length >= 3 && /^[A-Za-z]{2}$/.test(parts[1]!)) {
    const zip = /^\d{5}/.exec(parts[2]!)?.[0];
    return `${title(parts[0]!)}, ${parts[1]!.toUpperCase()}${zip ? ` ${zip}` : ''}`;
  }
  if (parts.length === 2 && !/\d/.test(parts[0]!) && /^[A-Za-z]{2}( \d{5})?$/.test(parts[1]!)) {
    return `${title(parts[0]!)}, ${parts[1]!.toUpperCase()}`;
  }
  return null;
}

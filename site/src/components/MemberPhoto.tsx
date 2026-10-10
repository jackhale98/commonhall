import { initials } from '../lib/format';

interface Props {
  name: string;
  url: string | null;
  /** Members of Congress: fall back to the public-domain unitedstates/images portrait. */
  bioguideId?: string | null;
  size?: number;
  /** Above the fold (a profile's main photo): load right away instead of lazily. */
  eager?: boolean;
}

/** Public-domain portraits from the unitedstates project, keyed by bioguide id (hotlinked, never stored). */
export function congressPortrait(bioguideId: string): string {
  return `https://unitedstates.github.io/images/congress/225x275/${bioguideId}.jpg`;
}

/**
 * Official photo, loaded straight from its source by the browser. A tiny handler
 * in the page head (Base.astro) swaps in `data-fallback` and then the initials if
 * an image fails, so broken links never show. Decorative next to the name.
 */
export default function MemberPhoto({ name, url, bioguideId, size = 96, eager = false }: Props) {
  const height = Math.round(size * 1.2);
  const style = { width: `${size}px`, height: `${height}px` };
  const portrait = bioguideId ? congressPortrait(bioguideId) : null;
  const src = url ?? portrait;
  if (!src) {
    // Initials scale with the badge, so two letters fit a small one.
    return (
      <span
        class="photo photo-fallback"
        style={{ ...style, fontSize: `${Math.min(19, Math.round(size * 0.4))}px` }}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      class="photo"
      src={src}
      alt=""
      width={size}
      height={height}
      style={style}
      loading={eager ? 'eager' : 'lazy'}
      fetchpriority={eager ? 'high' : undefined}
      decoding="async"
      referrerpolicy="no-referrer"
      data-initials={initials(name)}
      data-fallback={url && portrait && portrait !== url ? portrait : undefined}
    />
  );
}

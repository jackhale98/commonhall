import { initials } from '../lib/format';

interface Props {
  name: string;
  url: string | null;
  size?: number;
}

/** Official photo, or initials when there is none. Decorative next to the name. */
export default function MemberPhoto({ name, url, size = 96 }: Props) {
  const style = { width: `${size}px`, height: `${Math.round(size * 1.2)}px` };
  if (!url) {
    return (
      <span class="photo photo-fallback" style={style} aria-hidden="true">
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      class="photo"
      src={url}
      alt=""
      width={size}
      height={Math.round(size * 1.2)}
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
    />
  );
}

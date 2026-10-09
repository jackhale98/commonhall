export interface BarItem {
  label: string;
  value: number;
  href?: string;
  /** Optional detail shown after the value. */
  note?: string;
}

/** Labelled horizontal bars, largest first, each optionally a link. */
export default function BarList({
  items,
  label,
  tone = 'fill-brand',
  prefix = '',
}: {
  items: BarItem[];
  label: string;
  tone?: string;
  /** Shown before each value, e.g. "$". */
  prefix?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul class="barlist" aria-label={label}>
      {items.map((item) => (
        <li>
          <span class="barlist-label">{item.href ? <a href={item.href}>{item.label}</a> : item.label}</span>
          <span class="barlist-track" aria-hidden="true">
            <span class={`barlist-fill ${tone}`} style={{ width: `${(item.value / max) * 100}%` }} />
          </span>
          <span class="barlist-value">
            {prefix}
            {item.value.toLocaleString()}
            {item.note && <span class="muted"> {item.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

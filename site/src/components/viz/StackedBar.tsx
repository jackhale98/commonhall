export interface Segment {
  label: string;
  value: number;
  /** CSS class for the fill, e.g. "fill-yea" or "fill-party-d". */
  tone: string;
}

interface Props {
  segments: Segment[];
  /** Accessible summary; defaults to "label value, …". */
  label?: string;
  /** Show a legend with values under the bar. */
  legend?: boolean;
  /** Mark a threshold (0–1), e.g. the share needed to pass. */
  marker?: number;
  size?: 'sm' | 'md';
}

/** A single horizontal bar split into segments. Plain HTML and CSS, no script. */
export default function StackedBar({ segments, label, legend = false, marker, size = 'md' }: Props) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const summary = label ?? segments.map((s) => `${s.label} ${s.value}`).join(', ');
  return (
    <div class={`stacked stacked-${size}`}>
      <div class="stacked-bar" role="img" aria-label={summary}>
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span
                class={`stacked-seg ${s.tone}`}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.label}: ${s.value}`}
              />
            ))}
        {marker !== undefined && <span class="stacked-marker" style={{ left: `${marker * 100}%` }} />}
      </div>
      {legend && (
        <ul class="legend" aria-hidden="true">
          {segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <li>
                <span class={`swatch ${s.tone}`} />
                {s.label} <strong>{s.value.toLocaleString()}</strong>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

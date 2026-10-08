/** A percentage ring with the number in the middle. */
export default function Ring({ value, label, tone = 'stroke-brand' }: { value: number; label: string; tone?: string }) {
  const r = 15.9155; // circumference 100
  const v = Math.max(0, Math.min(100, value));
  return (
    <figure class="ring">
      <svg viewBox="0 0 36 36" role="img" aria-label={`${label}: ${v}%`}>
        <circle cx="18" cy="18" r={r} class="ring-track" />
        <circle
          cx="18"
          cy="18"
          r={r}
          class={`ring-value ${tone}`}
          stroke-dasharray={`${v} ${100 - v}`}
          stroke-dashoffset="25"
        />
        <text x="18" y="20.5" text-anchor="middle" class="ring-text">
          {Number.isInteger(v) ? v : v.toFixed(1)}%
        </text>
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

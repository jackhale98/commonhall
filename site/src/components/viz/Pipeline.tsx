import type { BarItem } from './BarList';

/** Where bills stand: one row per stage, bar width relative to the largest stage. */
export default function Pipeline({ stages, label }: { stages: BarItem[]; label: string }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <ol class="pipeline" aria-label={label}>
      {stages.map((s, i) => (
        <li>
          <a href={s.href} class="pipeline-row">
            <span class="pipeline-label">{s.label}</span>
            <span class="pipeline-track" aria-hidden="true">
              <span
                class={`pipeline-fill stage-${i}`}
                style={{ width: s.value > 0 ? `${Math.max(1.5, (s.value / max) * 100)}%` : '0' }}
              />
            </span>
            <span class="pipeline-value">{s.value.toLocaleString()}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

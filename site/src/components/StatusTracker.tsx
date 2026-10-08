import { statusStepIndex, statusSteps, type BillStatus } from '@civic/congress-client/status';
import { statusLabel } from '../lib/format';

interface Props {
  billType: string;
  status: BillStatus;
}

/** Introduced → committee → passed chamber → passed both → president → law. */
export default function StatusTracker({ billType, status }: Props) {
  const steps = statusSteps(billType);
  const current = statusStepIndex(billType, status);
  const vetoed = status === 'vetoed';
  return (
    <div class="tracker">
      <p class="tracker-label">
        Status: <strong>{statusLabel(status)}</strong>
      </p>
      <ol class="tracker-steps" aria-label="Progress through Congress">
        {steps.map((step, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'todo';
          return (
            <li class={`step step-${state}`} aria-current={i === current ? 'step' : undefined}>
              <span class="step-dot" aria-hidden="true">
                {i <= current ? '✓' : ''}
              </span>
              <span class="step-name">
                {step.label}
                {i === current && vetoed ? ' (vetoed)' : ''}
                <span class="visually-hidden">
                  {state === 'done' ? ' (done)' : state === 'current' ? ' (current)' : ''}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

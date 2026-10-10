import { useEffect, useRef, useState } from 'preact/hooks';

/** Seat centres in the 32×32 mark, plus the outward direction each one hops. */
const SEATS: [number, number, number, number][] = [
  [25.08, 6.94, 0.62, -0.79],
  [17.06, 4.54, -0.08, -1],
  [9.54, 8.21, -0.73, -0.68],
  [6.5, 16, -1, 0],
  [9.54, 23.79, -0.73, 0.68],
  [17.06, 27.46, -0.08, 1],
  [25.08, 25.06, 0.62, 0.79],
];

export const LOADING_MESSAGES = [
  'Calling the roll…',
  'Checking for a quorum…',
  'Taking our seats…',
  'Counting the ayes and nays…',
  'Opening the floor…',
  'Hearing from the public…',
  'Tallying the votes…',
  'The ayes have it…',
];

interface Props {
  /** A fixed message. Leave it out to rotate through LOADING_MESSAGES. */
  message?: string;
  /** Just the mark, sized to the surrounding text (for buttons). The caller supplies the text. */
  inline?: boolean;
  /** What screen readers hear. */
  label?: string;
  class?: string;
}

export function LoaderMark({ class: className = '' }: { class?: string }) {
  return (
    <svg class={`ch-loader ${className}`.trim()} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      {SEATS.map(([cx, cy, dx, dy], i) => (
        <g class="ch-seat" style={`--i:${i};--dx:${dx};--dy:${dy}`} key={i}>
          <circle cx={cx} cy={cy} r="2.15" />
        </g>
      ))}
      <circle class="ch-ring" cx="18" cy="16" r="8" />
      <circle class="ch-you" cx="18" cy="16" r="3.4" />
    </svg>
  );
}

/**
 * The CommonHall "roll call" loader: seats fill in as members vote, your amber ballot
 * comes in through the open side, the gavel falls and the room applauds. Under
 * prefers-reduced-motion the seats still fill in turn, but nothing moves.
 */
export default function Loader({ message, inline = false, label = 'Loading', class: className = '' }: Props) {
  const [n, setN] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const rotate = !message && !inline;

  useEffect(() => {
    const el = box.current;
    if (!rotate || !el) return;
    const first = el.querySelector('.ch-seat circle');
    // A new message each time the roll call starts over.
    const onLoop = (e: Event) => {
      if (e.target === first) setN((i) => (i + 1) % LOADING_MESSAGES.length);
    };
    el.addEventListener('animationiteration', onLoop);
    return () => el.removeEventListener('animationiteration', onLoop);
  }, [rotate]);

  if (inline) return <LoaderMark class={`ch-loader--inline ${className}`.trim()} />;

  const text = message ?? LOADING_MESSAGES[n];
  return (
    <div class={`ch-loading ${className}`.trim()} role="status" ref={box}>
      <span class="visually-hidden">{label}</span>
      <LoaderMark />
      <span class="ch-msg" aria-hidden="true" key={text}>
        {text}
      </span>
    </div>
  );
}

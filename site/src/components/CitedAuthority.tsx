import type { ClauseLink } from '../lib/respublica';

/**
 * The constitutional provisions a bill's sponsor cites as Congress's authority to pass
 * it, each linked to its text on Res Publica. Nothing when there are none.
 */
export default function CitedAuthority({ links }: { links: ClauseLink[] }) {
  if (!links.length) return null;
  return (
    <p class="small cited-authority">
      <span class="muted">Constitutional authority the sponsor cites:</span>{' '}
      {links.map((l, i) => (
        <>
          {i > 0 && ', '}
          <a href={l.url} rel="noopener" title="Read it in Res Publica, a library of founding texts">
            {l.label}
          </a>
        </>
      ))}
    </p>
  );
}

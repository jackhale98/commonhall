import { useEffect, useState } from 'preact/hooks';
import { hasStoredSession, isAdmin } from '../lib/auth';
import { href } from '../lib/paths';

const CACHE_KEY = 'civic.is-admin';

/** A link to the discussions admin page, shown only to signed-in maintainers. */
export default function AdminLink({ variant = 'link' }: { variant?: 'link' | 'button' }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!hasStoredSession()) return;
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached !== null) return setShow(cached === '1');
    } catch {
      // No session storage: ask every time.
    }
    isAdmin()
      .then((yes) => {
        setShow(yes);
        try {
          sessionStorage.setItem(CACHE_KEY, yes ? '1' : '0');
        } catch {
          // Ignore.
        }
      })
      .catch(() => undefined);
  }, []);
  if (!show) return null;
  return (
    <a class={variant === 'button' ? 'button' : undefined} href={href('admin/discussions/')}>
      Admin: discussions
    </a>
  );
}

import { useEffect, useState } from 'preact/hooks';
import { getClient, hasStoredSession } from '../lib/auth';

/** Unread count next to "Feed" for signed-in users; renders nothing otherwise. */
export default function NavStatus() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!hasStoredSession()) return;
    (async () => {
      const client = await getClient();
      const { data } = await client.auth.getSession();
      if (!data.session) return;
      const { data: n } = await client.rpc('feed_unread_count');
      if (typeof n === 'number') setCount(n);
    })().catch(() => undefined);
  }, []);
  if (count === 0) return null;
  return (
    <span class="badge" aria-label={`${count} unread`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

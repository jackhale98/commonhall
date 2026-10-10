import { useEffect, useState } from 'preact/hooks';
import { DEMO } from '../lib/config';
import { localMatterHref } from '../lib/paths';
import { redirectIfPrerendered } from '../lib/prerendered';
import DiscussionRequest from './DiscussionRequest';
import LocalMatterView, { loadMatter, type MatterData } from './LocalMatterView';
import Loader from './Loader';

/** Client-rendered page for council matters without a prerendered page (?id=MatterId). */
export default function LocalMatterFallback() {
  const [data, setData] = useState<MatterData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'invalid' | 'error'>('loading');
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('id') ?? '';
    if (!/^\d+$/.test(raw)) return setState('invalid');
    const id = `boston-${raw}`;
    redirectIfPrerendered((i) => (i.localMatters.includes(id) ? localMatterHref(id) : null))
      .then((redirecting) => (redirecting ? undefined : loadMatter(id)))
      .then((d) => {
        if (d === undefined) return;
        if (!d) return setState('missing');
        setData(d);
        setState('ready');
        document.title = `${d.matter.file_number ? `Docket #${d.matter.file_number}` : 'Council matter'} · ${document.title.split(' · ').pop()}`;
      })
      .catch(() => setState('error'));
  }, []);
  if (state === 'loading') return <Loader label="Loading council matter" />;
  if (state === 'invalid') return <p class="notice error">That isn’t a valid matter id.</p>;
  if (state === 'missing') {
    return (
      <p class="notice">
        {DEMO
          ? 'This demo includes only a sample of Boston City Council matters, and that one isn’t among them.'
          : 'We don’t have that council matter. It may not be council legislation, or it may not be synced yet.'}
      </p>
    );
  }
  if (state === 'error' || !data) return <p class="notice error">Couldn’t load this matter.</p>;
  return (
    <>
      <DiscussionRequest targetType="local_matter" targetId={data.matter.id} />
      <LocalMatterView {...data} />
    </>
  );
}

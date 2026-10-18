import { loadConstitutionIndex } from '../../lib/build-data';

/**
 * The Constitution's provisions on Res Publica (ref → label and link), served from this
 * site so bill pages that load on request can link the clauses a sponsor cites without
 * the browser asking another site. Empty when the library couldn't be read at build.
 */
export async function GET() {
  return new Response(JSON.stringify((await loadConstitutionIndex()) ?? {}), {
    headers: { 'content-type': 'application/json' },
  });
}

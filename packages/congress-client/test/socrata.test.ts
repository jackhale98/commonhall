import { describe, expect, it } from 'vitest';
import { SocrataClient, soqlString } from '../src/socrata.ts';
import { ShapeError } from '../src/shape.ts';

describe('SocrataClient', () => {
  it('pages through a query with SoQL parameters', async () => {
    const calls: URL[] = [];
    const fetch = async (input: string) => {
      const u = new URL(input);
      calls.push(u);
      const offset = Number(u.searchParams.get('$offset'));
      const rows = offset === 0 ? [{ n: '1' }, { n: '2' }] : [{ n: '3' }];
      return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
    };
    const client = new SocrataClient('https://data.example.gov/', { fetch });
    const rows = await client.all<{ n: string }>(
      'abcd-1234',
      { $where: `type = ${soqlString("O'Neil")}` },
      { n: 'string' },
      2,
    );
    expect(rows.map((r) => r.n)).toEqual(['1', '2', '3']);
    expect(calls[0]!.host).toBe('data.example.gov');
    expect(calls[0]!.pathname).toBe('/resource/abcd-1234.json');
    expect(calls[0]!.searchParams.get('$where')).toBe("type = 'O''Neil'");
    expect(calls).toHaveLength(2);
  });

  it('fails when a column it relies on is gone', async () => {
    const fetch = async () => new Response(JSON.stringify([{ other: 1 }]));
    const client = new SocrataClient('data.example.gov', { fetch });
    await expect(client.all('x', {}, { n: 'string' })).rejects.toBeInstanceOf(ShapeError);
  });
});

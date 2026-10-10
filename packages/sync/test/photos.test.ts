import { describe, expect, it } from 'vitest';
import { choosePhoto, smallerCopies } from '../src/state/photos.ts';

const image = (bytes: number) =>
  new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes) } });

describe('smallerCopies', () => {
  it('uses Wikimedia thumbnails', () => {
    expect(smallerCopies('https://upload.wikimedia.org/wikipedia/commons/a/ab/Kim_Driscoll.jpg')).toEqual([
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Kim_Driscoll.jpg/240px-Kim_Driscoll.jpg',
    ]);
    expect(smallerCopies('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/240px-X.jpg')).toEqual([]);
  });

  it('uses WordPress’s smaller crops', () => {
    expect(
      smallerCopies('https://senatedems.delaware.gov/wp-content/files/2022/09/Cruce-Headshot-2025-710x710.jpg'),
    ).toEqual([
      'https://senatedems.delaware.gov/wp-content/files/2022/09/Cruce-Headshot-2025-300x300.jpg',
      'https://senatedems.delaware.gov/wp-content/files/2022/09/Cruce-Headshot-2025-150x150.jpg',
    ]);
    expect(smallerCopies('https://example.gov/photos/a.jpg')).toEqual([]);
  });
});

describe('choosePhoto', () => {
  const wp = 'https://x.gov/wp-content/a/Pettyjohn.png';
  it('keeps a small photo', async () => {
    expect(await choosePhoto(async () => image(40_000), wp)).toEqual({ use: wp, bytes: 40_000 });
  });

  it('takes the smaller copy of a heavy photo', async () => {
    const fetch = async (url: string) =>
      url.endsWith('-300x300.png')
        ? new Response(null, { status: 404 })
        : url.endsWith('-150x150.png')
          ? image(20_000)
          : image(700_000);
    expect(await choosePhoto(fetch, wp)).toEqual({
      use: 'https://x.gov/wp-content/a/Pettyjohn-150x150.png',
      bytes: 20_000,
    });
  });

  it('drops a very heavy photo with no smaller copy, and leaves unreadable ones for later', async () => {
    expect(await choosePhoto(async () => image(10_200_000), 'https://www.mass.gov/lg.jpg')).toEqual({
      use: null,
      bytes: 10_200_000,
    });
    expect(
      await choosePhoto(async () => new Response(null, { status: 503 }), 'https://www.mass.gov/lg.jpg'),
    ).toBeNull();
  });
});

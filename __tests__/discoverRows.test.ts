jest.mock('../src/lib/stremio', () => ({fetchCatalog: jest.fn(), fetchMeta: jest.fn(), findImdb: jest.fn()}));
jest.mock('../src/lib/zustand/continueWatchingStore', () => jest.fn());
jest.mock('../src/components/MediaPosterCard', () => 'MediaPosterCard');
jest.mock('../src/components/ui/Text', () => 'AppText');
import {similarTitles, yearOf} from '../src/components/DiscoverRows';

const meta = (id: string, poster = 'p') => ({id, type: 'movie', name: id, poster});

describe('discover rows', () => {
  it('drops the watched title and titles without a poster', () => {
    const rows = similarTitles([meta('a'), meta('b'), {...meta('c'), poster: undefined}, meta('d')], 'a');
    expect(rows.map(item => item.id)).toEqual(['b', 'd']);
  });

  it('limits the row', () => {
    expect(similarTitles([meta('a'), meta('b'), meta('c')], 'x', 2)).toHaveLength(2);
  });

  it('reads the year from release info', () => {
    expect(yearOf({...meta('a'), releaseInfo: '1999–2003'})).toBe(1999);
    expect(yearOf(meta('a'))).toBeUndefined();
  });
});

// Grouping the fixture tree into movies, shows and other videos.
import {groupNetlib, itemTab} from '../src/lib/netlib/group';
import {parseVersionKey} from '../src/lib/netlib/ids';

const tree: Array<{path: string}> = require('./fixtures/netlibTree.json');
const files = tree.map((row, index) => {
  const parts = row.path.split('/');
  return {path: `/${row.path}`, name: parts[parts.length - 1], folders: parts.slice(0, -1), modified: index};
});

describe('netlib grouping', () => {
  const items = groupNetlib('src1', files);
  const byTitle = (title: string) => items.find(item => item.title === title)!;

  it('makes one movie per title and year with its versions, best first', () => {
    const inception = byTitle('Inception');
    expect(inception.kind).toBe('movie');
    expect(inception.versions.map(version => version.resolution)).toEqual(['2160p', '1080p']);
    expect(parseVersionKey(inception.versions[0].key)).toEqual({sourceId: 'src1', path: expect.stringContaining('2160p')});
    expect(byTitle('Seven Samurai').versions.map(version => version.part)).toEqual([1, 2]);
  });

  it('makes one show per title with sorted episodes and versions', () => {
    const show = byTitle('Breaking Bad');
    expect(show.kind).toBe('show');
    expect(show.episodes.map(episode => `${episode.season}x${episode.episode}`)).toEqual(['0x1', '1x1', '1x2', '2x1']);
    expect(show.episodes[3].versions).toHaveLength(2);
    expect(byTitle('Game of Thrones').episodes[0]).toMatchObject({season: 8, episode: 1, lastEpisode: 2});
    expect(byTitle('One Piece').episodes.map(episode => episode.episode)).toEqual([1071, 1072]);
  });

  it('sorts titles into tabs and keeps the newest file time', () => {
    expect(itemTab(byTitle('Interstellar'))).toBe('other');
    expect(itemTab({...byTitle('Interstellar'), match: {type: 'movie', title: 'Interstellar'}})).toBe('movies');
    expect(itemTab(byTitle('Friends'))).toBe('shows');
    expect(items.filter(item => item.kind === 'other').length).toBeGreaterThanOrEqual(5);
    expect(byTitle('Breaking Bad').added).toBe(25);
    expect(byTitle('Parasite').tmdbId).toBe(496243);
  });
});

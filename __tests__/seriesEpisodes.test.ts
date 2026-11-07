import {describe, expect, it} from '@jest/globals';
import {
  cleanEpisodeTitle,
  episodeFileName,
  nextSeasonTitle,
  nextUnwatched,
  numberEpisodes,
  parseEpisodeNumber,
  parseSeasonNumber,
  seasonFolderName,
  selectEpisodeRange,
} from '../src/lib/seriesDownloads/episodes';

const season = (count: number) => Array.from({length: count}, (_, index) => ({title: `Episode ${index + 1}`, link: `e${index + 1}`, index}));

describe('season and episode numbers', () => {
  it('reads season numbers from provider titles', () => {
    expect(parseSeasonNumber('Season 2 [1080p]')).toBe(2);
    expect(parseSeasonNumber('S03 Hindi')).toBe(3);
    expect(parseSeasonNumber('2nd Season')).toBe(2);
    expect(parseSeasonNumber('Download Links')).toBeUndefined();
  });

  it('reads episode numbers, else uses the position', () => {
    expect(parseEpisodeNumber('Episode 7', 0)).toBe(7);
    expect(parseEpisodeNumber('S01E12 - The End', 0)).toBe(12);
    expect(parseEpisodeNumber('E05 Pilot', 0)).toBe(5);
    expect(parseEpisodeNumber('4. The Rain', 0)).toBe(4);
    expect(parseEpisodeNumber('The Rain', 8)).toBe(9);
  });

  it('numbers a season with its season number', () => {
    const numbered = numberEpisodes(season(2), 'Season 3');
    expect(numbered.map(item => [item.season, item.episode])).toEqual([[3, 1], [3, 2]]);
  });
});

describe('episode range selection', () => {
  it('takes the whole season without a range', () => {
    expect(selectEpisodeRange(season(5))).toHaveLength(5);
  });

  it('takes a range, both ends included', () => {
    expect(selectEpisodeRange(season(10), {from: 3, to: 5}).map(item => item.link)).toEqual(['e3', 'e4', 'e5']);
  });

  it('clamps and swaps a range that is out of order or too long', () => {
    expect(selectEpisodeRange(season(4), {from: 6, to: 2}).map(item => item.link)).toEqual(['e2', 'e3', 'e4']);
    expect(selectEpisodeRange(season(4), {from: 0, to: 99})).toHaveLength(4);
    expect(selectEpisodeRange([], {from: 1, to: 3})).toEqual([]);
  });

  it('picks the next unwatched episodes after the last watched one', () => {
    const watched = new Set(['e1', 'e2', 'e4']);
    // e3 was skipped and stays behind: "next" starts after the last watched.
    expect(nextUnwatched(season(8), item => watched.has(item.link), 3).map(item => item.link)).toEqual(['e5', 'e6', 'e7']);
    expect(nextUnwatched(season(3), () => false, 2).map(item => item.link)).toEqual(['e1', 'e2']);
    expect(nextUnwatched(season(3), () => true, 2)).toEqual([]);
  });
});

describe('download names', () => {
  it('names the season folder Season NN', () => {
    expect(seasonFolderName('Season 1 [720p]')).toBe('Season 01');
    expect(seasonFolderName('Extras')).toBe('Extras');
    expect(seasonFolderName(undefined)).toBeUndefined();
  });

  it('names files S01E02 Title', () => {
    expect(episodeFileName(1, 2, 'Episode 2 - The Pilot')).toBe('S01E02 The Pilot');
    expect(episodeFileName(1, 2, 'Episode 2')).toBe('S01E02');
    expect(episodeFileName(2, 10, 'S02E10: Winter: Is Here?')).toBe('S02E10 Winter Is Here');
    expect(episodeFileName(undefined, 3, 'Ep 3')).toBe('E03');
  });

  it('leaves a plain title alone', () => {
    expect(cleanEpisodeTitle('The Long Night')).toBe('The Long Night');
  });
});

describe('next season', () => {
  it('moves to the season numbered one higher, same quality when there is one', () => {
    const titles = ['Season 1 [720p]', 'Season 1 [1080p]', 'Season 2 [720p]', 'Season 2 [1080p]'];
    expect(nextSeasonTitle(titles, 'Season 1 [1080p]')).toBe('Season 2 [1080p]');
    expect(nextSeasonTitle(['Season 1', 'Season 2'], 'Season 1')).toBe('Season 2');
    expect(nextSeasonTitle(['Season 1', 'Season 2'], 'Season 2')).toBeUndefined();
    expect(nextSeasonTitle(['Part A', 'Part B'], 'Part A')).toBe('Part B');
  });
});

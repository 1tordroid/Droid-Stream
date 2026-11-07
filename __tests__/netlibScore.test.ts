// Choosing a TMDB or Cinemeta candidate, and the match cache times.
import {pickBest, scoreCandidate, titleSimilarity} from '../src/lib/netlib/match/score';

describe('netlib match scoring', () => {
  it('compares titles after normalising', () => {
    expect(titleSimilarity('Amélie', 'Amelie')).toBe(1);
    expect(titleSimilarity('Matrix', 'The Matrix')).toBeGreaterThan(0.9);
    expect(titleSimilarity('Oceans 11', 'Ocean Eleven')).toBeLessThan(0.72);
  });

  it('lets the year decide between remakes', () => {
    const candidates = [
      {title: 'Dune', year: 1984, popularity: 20},
      {title: 'Dune', year: 2021, popularity: 90},
    ];
    expect(pickBest({title: 'Dune', year: 1984}, candidates)?.year).toBe(1984);
    expect(pickBest({title: 'Dune'}, candidates)?.year).toBe(2021);
    expect(scoreCandidate({title: 'Dune', year: 2021}, {title: 'Dune', year: 1984})).toBeLessThan(0.72);
  });

  it('matches original titles and refuses weak candidates', () => {
    expect(pickBest({title: 'Sen to Chihiro no Kamikakushi'}, [{title: 'Spirited Away', originalTitle: 'Sen to Chihiro no Kamikakushi'}])).toBeDefined();
    expect(pickBest({title: 'Birthday', year: 2019}, [{title: 'The Birthday Party', year: 1968}])).toBeUndefined();
  });

  it('keeps hits 180 days and misses 7 days', () => {
    const cache = require('../src/lib/netlib/cache');
    const day = 24 * 60 * 60 * 1000;
    cache.setCachedMatch('hit', {type: 'movie', title: 'X'}, 0);
    cache.setCachedMatch('miss', undefined, 0);
    expect(cache.getCachedMatch('hit', 179 * day)).toMatchObject({title: 'X'});
    expect(cache.getCachedMatch('hit', 181 * day)).toBeUndefined();
    expect(cache.getCachedMatch('miss', 6 * day)).toBeNull();
    expect(cache.getCachedMatch('miss', 8 * day)).toBeUndefined();
  });

  it('is cleared by Erase all', () => {
    const cache = require('../src/lib/netlib/cache');
    const {clearAllMMKVStorage} = require('../src/lib/storage/StorageService');
    cache.saveLibrary({sourceId: 'x', scannedAt: 1, items: []});
    clearAllMMKVStorage();
    expect(cache.loadLibrary('x')).toBeUndefined();
  });
});

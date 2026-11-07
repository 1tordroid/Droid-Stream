import {describe, expect, it} from '@jest/globals';
import {
  hasAdultWords,
  isAdultSource,
  isKidsChannelGroup,
  isKidsSafe,
  isRestrictedCertification,
} from '../src/lib/profiles/kids';

describe('kids ratings', () => {
  it('hides teen and adult certifications from several countries', () => {
    for (const code of ['R', 'NC-17', 'TV-MA', 'TV-14', 'PG-13', '15', '16', '18', 'U/A 13+', 'UA 16+', 'A', 'MA15+', 'R18', 'x']) {
      expect(isRestrictedCertification(code)).toBe(true);
    }
  });

  it('keeps kids and family certifications, and titles with no rating', () => {
    for (const code of ['G', 'PG', 'TV-Y', 'TV-Y7', 'TV-Y7-FV', 'TV-G', 'TV-PG', 'U', 'U/A 7+', '0', '6', '12', '12A', '', undefined, null, 'NR']) {
      expect(isRestrictedCertification(code)).toBe(false);
    }
  });

  it('blocks the TMDB adult flag and adult tags or genres', () => {
    expect(isKidsSafe({adult: true})).toBe(false);
    expect(isKidsSafe({certification: 'PG', tags: ['Comedy', '18+']})).toBe(false);
    expect(isKidsSafe({genres: ['Erotic']})).toBe(false);
    expect(isKidsSafe({genres: ['Hentai']})).toBe(false);
    expect(isKidsSafe({certification: 'R'})).toBe(false);
    expect(isKidsSafe({certification: 'G', genres: ['Animation', 'Family'], tags: ['Kids']})).toBe(true);
    expect(isKidsSafe({})).toBe(true);
  });

  it('matches adult words as words, not inside other words', () => {
    expect(hasAdultWords('Adult Movies')).toBe(true);
    expect(hasAdultWords('XXX channel')).toBe(true);
    expect(hasAdultWords('Sussex Police')).toBe(false);
    expect(hasAdultWords('Essex')).toBe(false);
    expect(hasAdultWords('Animation', undefined, null)).toBe(false);
  });
});

describe('kids Live TV groups', () => {
  it('keeps only kids, animation and cartoon groups', () => {
    expect(isKidsChannelGroup('Kids')).toBe(true);
    expect(isKidsChannelGroup('Animation')).toBe(true);
    expect(isKidsChannelGroup('Cartoons')).toBe(true);
    expect(isKidsChannelGroup('kids;Entertainment')).toBe(true);
    expect(isKidsChannelGroup('News')).toBe(false);
    expect(isKidsChannelGroup('Movies')).toBe(false);
    expect(isKidsChannelGroup('')).toBe(false);
    expect(isKidsChannelGroup(undefined)).toBe(false);
  });
});

describe('kids providers and add-ons', () => {
  it('hides adult-flagged and adult-named sources', () => {
    expect(isAdultSource({name: 'Some add-on', adult: true})).toBe(true);
    expect(isAdultSource({name: 'NSFW Hub'})).toBe(true);
    expect(isAdultSource({value: 'porn-site'})).toBe(true);
    expect(isAdultSource({name: 'Cinemeta', adult: false})).toBe(false);
    expect(isAdultSource({name: 'Anime World', value: 'animeworld'})).toBe(false);
  });
});

import {episodeTag, parseRelease, releaseMatches} from '../src/lib/releaseName';

it('parses a TV release', () => {
  expect(parseRelease('The.Last.of.Us.S02E05.1080p.WEB-DL.DDP5.1.x265-GROUP.mkv')).toMatchObject({
    title: 'The Last of Us', season: 2, episode: 5, resolution: '1080p', source: 'WEB-DL', codec: 'HEVC', audio: 'DD+', group: 'GROUP',
  });
});

it('parses a movie release with year, HDR and languages', () => {
  expect(parseRelease('Dune Part Two (2024) 2160p UHD BluRay REMUX DV HDR Hindi English Atmos')).toMatchObject({
    title: 'Dune Part Two', year: 2024, resolution: '2160p', source: 'Remux', hdr: 'DV', audio: 'Atmos', language: ['Hindi'],
  });
  expect(parseRelease('2001.A.Space.Odyssey.1968.1080p.BluRay.x264').year).toBe(1968);
});

it('parses packs, multi-episode, NxM and anime numbering', () => {
  expect(parseRelease('Breaking Bad Season 3 Complete 720p')).toMatchObject({title: 'Breaking Bad', season: 3, seasonPack: true});
  expect(parseRelease('Show.S01E01-E03.720p').episodes).toEqual([1, 2, 3]);
  expect(parseRelease('Show 3x07 HDTV')).toMatchObject({season: 3, episode: 7});
  expect(parseRelease('[SubsPlease] One Piece - 1071 (1080p) [ABCD1234].mkv')).toMatchObject({title: 'One Piece', absoluteEpisode: 1071, group: 'SubsPlease', resolution: '1080p'});
});

it('matches releases to a wanted title and episode', () => {
  expect(releaseMatches('The.Office.US.S03E04.720p', {title: 'The Office US', season: 3, episode: 4})).toBe(true);
  expect(releaseMatches('The.Office.US.S03E05.720p', {title: 'The Office US', season: 3, episode: 4})).toBe(false);
  expect(releaseMatches('Office Space 1999 1080p', {title: 'The Office US', season: 3, episode: 4})).toBe(false);
  expect(releaseMatches('Inception.2010.1080p.BluRay', {title: 'Inception', year: 2010})).toBe(true);
  expect(releaseMatches('Inception.2010.1080p.BluRay', {title: 'Inception', year: 2020})).toBe(false);
  expect(releaseMatches('Show S03 Complete 1080p', {title: 'Show', season: 3, episode: 2})).toBe(true);
  expect(episodeTag(1, 2)).toBe('S01E02');
});

it('takes a bracketed year over a number in the title', () => {
  expect(parseRelease('Blade Runner 2049 (2017) 2160p.mkv')).toMatchObject({title: 'Blade Runner 2049', year: 2017});
  expect(parseRelease('1917 (2019).mkv')).toMatchObject({title: '1917', year: 2019});
});

it('keeps a dot only in channel layouts and codec names', () => {
  expect(parseRelease('Oceans.11.2001.1080p.mkv')).toMatchObject({title: 'Oceans 11', year: 2001});
  const release = parseRelease('Movie.2019.1080p.DDP5.1.H.264-GRP.mkv');
  expect(release).toMatchObject({title: 'Movie', year: 2019, audio: 'DD+', codec: 'H.264'});
});

it('trims trailing dots from the title', () => {
  expect(parseRelease('Mr. Robot..S01E02.mkv').title).toBe('Mr Robot');
});

it('reads cd1, part1 and pt1', () => {
  expect(parseRelease('Movie.2004.CD1.avi')).toMatchObject({title: 'Movie', part: 1});
  expect(parseRelease('Long Film part2.mkv')).toMatchObject({title: 'Long Film', part: 2});
  expect(parseRelease('Film.pt1.mkv')).toMatchObject({title: 'Film', part: 1});
  expect(parseRelease('Harry Potter and the Deathly Hallows Part 2 (2011).mkv')).toMatchObject({title: 'Harry Potter and the Deathly Hallows Part 2', year: 2011});
  expect(parseRelease('Harry Potter and the Deathly Hallows Part 2 (2011).mkv').part).toBeUndefined();
});

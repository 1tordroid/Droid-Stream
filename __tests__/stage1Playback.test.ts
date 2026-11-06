import {parseVideoFileName, isVideoFileName} from '../src/lib/localLibrary/parseFileName';
import {markersToSkips} from '../src/lib/playback/introMarkerModel';

it('reads a title and year out of a release filename', () => {
  expect(parseVideoFileName('The.Matrix.1999.1080p.mkv')).toEqual({
    title: 'The Matrix',
    year: 1999,
    extension: 'mkv',
  });
  expect(isVideoFileName('movie.iso')).toBe(true);
  expect(isVideoFileName('notes.txt')).toBe(false);
});

it('turns remembered intro and credit points into skip ranges', () => {
  expect(markersToSkips({introEnd: 90, creditsStart: 5000, chapters: []})).toEqual([
    {title: 'Intro', from: 0, to: 90},
    {title: 'Credits', from: 5000, to: 5000 + 60 * 60 * 6},
  ]);
});

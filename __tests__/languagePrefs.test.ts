import {chooseAudioTrack, chooseSubtitleTrack, defaultLanguagePrefs, missingSubtitleLanguages, normalizeLanguage, NO_SUBTITLE} from '../src/lib/languagePrefs';

const prefs = {...defaultLanguagePrefs(), audioPrimary: 'hi', audioSecondary: 'en', subtitlePrimary: 'en', subtitleSecondary: 'hi'};

it('normalizes the many ways players name languages', () => {
  expect(normalizeLanguage('eng')).toBe('en');
  expect(normalizeLanguage('en-US')).toBe('en');
  expect(normalizeLanguage('Hindi (Original)')).toBe('hi');
  expect(normalizeLanguage('pob')).toBe('pt');
  expect(normalizeLanguage('und')).toBe('');
  expect(normalizeLanguage('Track 1')).toBe('');
});

it('picks primary audio, then secondary, then the last choice, skipping commentary', () => {
  const tracks = [{language: 'eng'}, {language: 'hin', title: 'Commentary'}, {language: 'hin', title: 'Hindi 5.1'}];
  expect(chooseAudioTrack(tracks, prefs)).toBe(2);
  expect(chooseAudioTrack([{language: 'jpn'}, {language: 'eng'}], prefs)).toBe(1);
  expect(chooseAudioTrack([{language: 'jpn'}, {language: 'kor'}], prefs, 'kor')).toBe(1);
  expect(chooseAudioTrack([{language: 'jpn'}], prefs)).toBe(-1);
});

it('shows subtitles only for foreign audio in the default mode', () => {
  const subs = [{language: 'hin'}, {language: 'eng', title: 'English SDH'}, {language: 'eng', title: 'English'}, {language: 'eng', title: 'Forced'}];
  expect(chooseSubtitleTrack(subs, prefs, {audioLanguage: 'jpn'})).toBe(2);
  expect(chooseSubtitleTrack(subs, prefs, {audioLanguage: 'hin'})).toBe(3);
  expect(chooseSubtitleTrack([{language: 'eng'}], prefs, {audioLanguage: 'hin'})).toBe(NO_SUBTITLE);
  expect(chooseSubtitleTrack(subs, {...prefs, subtitleMode: 'always'}, {audioLanguage: 'hin'})).toBe(2);
  expect(chooseSubtitleTrack(subs, {...prefs, subtitleMode: 'off'})).toBe(NO_SUBTITLE);
  expect(chooseSubtitleTrack(subs, {...defaultLanguagePrefs(), rememberLast: false})).toBe(-1);
});

it('reports subtitle languages to download', () => {
  expect(missingSubtitleLanguages([{language: 'fre'}], prefs, 'jpn')).toEqual(['en', 'hi']);
  expect(missingSubtitleLanguages([{language: 'eng'}], prefs, 'jpn')).toEqual([]);
  expect(missingSubtitleLanguages([], prefs, 'hin')).toEqual([]);
});

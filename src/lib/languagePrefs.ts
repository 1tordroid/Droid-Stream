/**
 * Preferred audio and subtitle languages, and the rules that pick a track
 * from what a video offers.
 */
import {openStore} from './storage/openStore';
import {profileKey} from './profiles/scope';

const storage = openStore('droid-stream-languages');

export interface Language {
  code: string;
  name: string;
  /** ISO 639-2 codes and other spellings players report. */
  aliases: string[];
}

export const LANGUAGES: Language[] = [
  {code: 'en', name: 'English', aliases: ['eng', 'english']},
  {code: 'hi', name: 'Hindi', aliases: ['hin', 'hindi', 'हिन्दी']},
  {code: 'ta', name: 'Tamil', aliases: ['tam', 'tamil']},
  {code: 'te', name: 'Telugu', aliases: ['tel', 'telugu']},
  {code: 'ml', name: 'Malayalam', aliases: ['mal', 'malayalam']},
  {code: 'kn', name: 'Kannada', aliases: ['kan', 'kannada']},
  {code: 'bn', name: 'Bengali', aliases: ['ben', 'bengali', 'bangla']},
  {code: 'mr', name: 'Marathi', aliases: ['mar', 'marathi']},
  {code: 'pa', name: 'Punjabi', aliases: ['pan', 'punjabi']},
  {code: 'gu', name: 'Gujarati', aliases: ['guj', 'gujarati']},
  {code: 'ur', name: 'Urdu', aliases: ['urd', 'urdu']},
  {code: 'ja', name: 'Japanese', aliases: ['jpn', 'japanese', 'jap']},
  {code: 'ko', name: 'Korean', aliases: ['kor', 'korean']},
  {code: 'zh', name: 'Chinese', aliases: ['chi', 'zho', 'chinese', 'mandarin', 'cantonese', 'chs', 'cht']},
  {code: 'es', name: 'Spanish', aliases: ['spa', 'spanish', 'español', 'espanol', 'castellano', 'latino', 'es-419']},
  {code: 'fr', name: 'French', aliases: ['fre', 'fra', 'french', 'français', 'francais', 'vff', 'vf']},
  {code: 'de', name: 'German', aliases: ['ger', 'deu', 'german', 'deutsch']},
  {code: 'it', name: 'Italian', aliases: ['ita', 'italian', 'italiano']},
  {code: 'pt', name: 'Portuguese', aliases: ['por', 'pob', 'portuguese', 'português', 'portugues', 'pt-br', 'brazilian']},
  {code: 'ru', name: 'Russian', aliases: ['rus', 'russian', 'русский']},
  {code: 'ar', name: 'Arabic', aliases: ['ara', 'arabic', 'العربية']},
  {code: 'tr', name: 'Turkish', aliases: ['tur', 'turkish', 'türkçe']},
  {code: 'pl', name: 'Polish', aliases: ['pol', 'polish', 'polski']},
  {code: 'nl', name: 'Dutch', aliases: ['dut', 'nld', 'dutch', 'nederlands']},
  {code: 'sv', name: 'Swedish', aliases: ['swe', 'swedish', 'svenska']},
  {code: 'no', name: 'Norwegian', aliases: ['nor', 'nob', 'norwegian', 'norsk']},
  {code: 'da', name: 'Danish', aliases: ['dan', 'danish', 'dansk']},
  {code: 'fi', name: 'Finnish', aliases: ['fin', 'finnish', 'suomi']},
  {code: 'el', name: 'Greek', aliases: ['gre', 'ell', 'greek']},
  {code: 'he', name: 'Hebrew', aliases: ['heb', 'hebrew']},
  {code: 'id', name: 'Indonesian', aliases: ['ind', 'indonesian', 'bahasa indonesia']},
  {code: 'ms', name: 'Malay', aliases: ['may', 'msa', 'malay', 'bahasa melayu']},
  {code: 'th', name: 'Thai', aliases: ['tha', 'thai']},
  {code: 'vi', name: 'Vietnamese', aliases: ['vie', 'vietnamese', 'tiếng việt']},
  {code: 'fa', name: 'Persian', aliases: ['per', 'fas', 'persian', 'farsi']},
  {code: 'uk', name: 'Ukrainian', aliases: ['ukr', 'ukrainian']},
  {code: 'cs', name: 'Czech', aliases: ['cze', 'ces', 'czech']},
  {code: 'hu', name: 'Hungarian', aliases: ['hun', 'hungarian']},
  {code: 'ro', name: 'Romanian', aliases: ['rum', 'ron', 'romanian']},
  {code: 'tl', name: 'Filipino', aliases: ['fil', 'tgl', 'filipino', 'tagalog']},
];

const BY_ALIAS = new Map<string, string>();
for (const language of LANGUAGES) {
  BY_ALIAS.set(language.code, language.code);
  BY_ALIAS.set(language.name.toLowerCase(), language.code);
  for (const alias of language.aliases) BY_ALIAS.set(alias.toLowerCase(), language.code);
}

/** "eng", "en-US", "English", "Hindi (Original)" → "en" / "hi". Unknown → "". */
export const normalizeLanguage = (value?: string | null): string => {
  if (!value) return '';
  const text = String(value).trim().toLowerCase();
  if (!text || text === 'und' || text === 'unknown') return '';
  const direct = BY_ALIAS.get(text) || BY_ALIAS.get(text.split(/[-_]/)[0]);
  if (direct) return direct;
  for (const word of text.split(/[^a-zÀ-ɏऀ-ॿЀ-ӿ؀-ۿ-]+/)) {
    const hit = word && BY_ALIAS.get(word);
    if (hit) return hit;
  }
  return '';
};

export const languageNameFor = (code?: string): string => LANGUAGES.find(language => language.code === normalizeLanguage(code))?.name || code || 'Unknown';

export type SubtitleMode =
  /** Pick a subtitle in the preferred languages whenever one exists. */
  | 'always'
  /** Only when the audio is not in a language you understand (your audio languages). */
  | 'foreign'
  /** Only forced / signs-and-songs tracks. */
  | 'forced'
  | 'off';

export interface LanguagePrefs {
  audioPrimary: string;
  audioSecondary: string;
  subtitlePrimary: string;
  subtitleSecondary: string;
  subtitleMode: SubtitleMode;
  /** Use the language picked by hand last time when no preference matches. */
  rememberLast: boolean;
  /** Fetch a subtitle online when the video has none in a preferred language. */
  autoDownloadSubtitles: boolean;
}

export const defaultLanguagePrefs = (): LanguagePrefs => ({
  audioPrimary: '',
  audioSecondary: '',
  subtitlePrimary: '',
  subtitleSecondary: '',
  subtitleMode: 'foreign',
  rememberLast: true,
  autoDownloadSubtitles: true,
});

export const readLanguagePrefs = (): LanguagePrefs => {
  try {
    return {...defaultLanguagePrefs(), ...JSON.parse(storage.getString(profileKey('prefs')) || '{}')};
  } catch {
    return defaultLanguagePrefs();
  }
};

export const writeLanguagePrefs = (prefs: LanguagePrefs): void => {
  storage.setString(profileKey('prefs'), JSON.stringify(prefs));
};

export interface TrackLike {
  language?: string | null;
  title?: string | null;
  selected?: boolean;
}

export const trackLanguage = (track: TrackLike): string => normalizeLanguage(track.language) || normalizeLanguage(track.title);

const isCommentary = (track: TrackLike) => /commentary|director|description|\bad\b|audio description/i.test(track.title || '');
const isForced = (track: TrackLike) => /forced|signs|songs/i.test(`${track.title || ''} ${track.language || ''}`);
const isSdh = (track: TrackLike) => /\bsdh\b|\bcc\b|hearing/i.test(track.title || '');

const wanted = (...values: (string | undefined)[]) => values.map(value => normalizeLanguage(value)).filter((value, index, all) => value && all.indexOf(value) === index);

/**
 * Index of the audio track to play, or -1 to keep the player's default.
 * Order: primary, secondary, then the language chosen by hand last time.
 * Commentary and audio-description tracks are skipped when possible.
 */
export const chooseAudioTrack = (tracks: TrackLike[], prefs: LanguagePrefs, last?: string): number => {
  const order = wanted(prefs.audioPrimary, prefs.audioSecondary, prefs.rememberLast ? last : undefined);
  for (const lang of order) {
    const matches = tracks.map((track, index) => ({track, index})).filter(item => trackLanguage(item.track) === lang);
    const main = matches.find(item => !isCommentary(item.track)) || matches[0];
    if (main) return main.index;
  }
  return -1;
};

/** Value meaning "no subtitles" in the player. */
export const NO_SUBTITLE = 1000;

/**
 * Index of the subtitle track to show, NO_SUBTITLE for none, or -1 when there
 * is no preference (the player keeps its old behaviour).
 */
export const chooseSubtitleTrack = (
  tracks: TrackLike[],
  prefs: LanguagePrefs,
  context: {audioLanguage?: string; last?: string} = {},
): number => {
  const order = wanted(prefs.subtitlePrimary, prefs.subtitleSecondary, prefs.rememberLast ? context.last : undefined);
  if (prefs.subtitleMode === 'off') return NO_SUBTITLE;
  if (!order.length) return -1;
  const indexed = tracks.map((track, index) => ({track, index}));
  const audio = normalizeLanguage(context.audioLanguage);
  const understood = wanted(prefs.audioPrimary, prefs.audioSecondary);

  if (prefs.subtitleMode === 'forced' || (prefs.subtitleMode === 'foreign' && audio && understood.includes(audio))) {
    // Audio is understood: only forced tracks (signs, foreign-language bits).
    const forced = indexed.find(item => isForced(item.track) && (!trackLanguage(item.track) || order.includes(trackLanguage(item.track))));
    return forced ? forced.index : NO_SUBTITLE;
  }
  for (const lang of order) {
    const matches = indexed.filter(item => trackLanguage(item.track) === lang && !isForced(item.track));
    const best = matches.find(item => !isSdh(item.track)) || matches[0];
    if (best) return best.index;
  }
  return -1;
};

/** Subtitle languages still missing from a video, for automatic download. */
export const missingSubtitleLanguages = (tracks: TrackLike[], prefs: LanguagePrefs, audioLanguage?: string): string[] => {
  if (prefs.subtitleMode === 'off' || prefs.subtitleMode === 'forced') return [];
  const audio = normalizeLanguage(audioLanguage);
  if (prefs.subtitleMode === 'foreign' && audio && wanted(prefs.audioPrimary, prefs.audioSecondary).includes(audio)) return [];
  const order = wanted(prefs.subtitlePrimary, prefs.subtitleSecondary);
  const present = new Set(tracks.map(trackLanguage));
  return order.some(lang => present.has(lang)) ? [] : order;
};

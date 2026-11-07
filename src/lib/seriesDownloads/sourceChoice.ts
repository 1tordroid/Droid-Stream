/**
 * The source a person picks for one episode (provider, server, quality and
 * language), and how the same kind of stream is found again for the other
 * episodes of the show.
 */
import type {Stream} from '../providers/types';
import {openStore} from '../storage/openStore';

export interface SourceChoice {
  provider: string;
  /** Server name as the provider showed it, e.g. "Filepress 1080p Hindi". */
  server?: string;
  /** "1080", "720" ... */
  quality?: string;
  /** Lower-case language name read from the server name, e.g. "hindi". */
  language?: string;
}

const LANGUAGES = ['hindi', 'english', 'tamil', 'telugu', 'malayalam', 'kannada', 'bengali', 'marathi', 'punjabi', 'gujarati', 'urdu', 'korean', 'japanese', 'spanish', 'french', 'german', 'italian', 'portuguese', 'russian', 'arabic', 'turkish', 'chinese', 'dual', 'multi'];
const LANGUAGE_CODES: Record<string, string> = {hin: 'hindi', eng: 'english', tam: 'tamil', tel: 'telugu', mal: 'malayalam', kan: 'kannada', jpn: 'japanese', kor: 'korean', spa: 'spanish'};

const textOf = (stream: Pick<Stream, 'server' | 'tag' | 'tags'>): string =>
  [stream.server, stream.tag, ...(stream.tags || [])].filter(Boolean).join(' ');

/** Quality as a number string ("1080"), from the stream's quality or its name. */
export const streamQuality = (stream: Pick<Stream, 'server' | 'quality' | 'tag' | 'tags'>): string | undefined => {
  const direct = /(\d{3,4})/.exec(String(stream.quality || ''))?.[1];
  if (direct) return direct;
  const text = textOf(stream);
  if (/\b4k\b|\buhd\b/i.test(text)) return '2160';
  return /\b(2160|1440|1080|720|576|480|360|240)p?\b/i.exec(text)?.[1];
};

/** First language named in the stream's server name or tags. */
export const streamLanguage = (stream: Pick<Stream, 'server' | 'tag' | 'tags'>): string | undefined => {
  const words = textOf(stream).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const word of words) {
    if (LANGUAGES.includes(word)) return word;
    if (LANGUAGE_CODES[word]) return LANGUAGE_CODES[word];
  }
  return undefined;
};

/** Server name without quality, size and language, so "Filepress 1080p" matches "Filepress 720p". */
export const serverFamily = (server?: string): string =>
  (server || '')
    .toLowerCase()
    .replace(/\b\d{3,4}p?\b|\b4k\b|\buhd\b|\bhdr\b|\b\d+(\.\d+)?\s?(gb|mb)\b/g, ' ')
    .replace(new RegExp(`\\b(${LANGUAGES.join('|')})\\b`, 'g'), ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const choiceFromStream = (stream: Stream, provider: string): SourceChoice => ({
  provider,
  server: stream.server || undefined,
  quality: streamQuality(stream),
  language: streamLanguage(stream),
});

/** How well a stream matches the choice. Higher is better. */
export const scoreStream = (stream: Stream, choice: SourceChoice): number => {
  let score = 0;
  const name = (stream.server || '').trim().toLowerCase();
  const wanted = (choice.server || '').trim().toLowerCase();
  if (wanted && name === wanted) score += 100;
  else if (wanted && serverFamily(name) && serverFamily(name) === serverFamily(wanted)) score += 60;
  const quality = streamQuality(stream);
  if (choice.quality && quality) {
    const want = Number(choice.quality);
    const have = Number(quality);
    if (have === want) score += 40;
    // A lower quality is a better stand-in than a bigger file.
    else if (have < want) score += 20 - Math.min(15, (want - have) / 120);
    else score += 5;
  }
  const language = streamLanguage(stream);
  if (choice.language) {
    if (language === choice.language) score += 30;
    else if (language === 'dual' || language === 'multi') score += 10;
    else if (language) score -= 30;
  }
  return score;
};

/**
 * The stream for another episode that is most like the chosen one. Ties keep
 * the provider's order. Without a choice, the provider's first stream.
 */
export const pickStream = (streams: Stream[], choice?: SourceChoice): Stream | undefined => {
  const usable = streams.filter(stream => stream?.link);
  if (!usable.length) return undefined;
  if (!choice) return usable[0];
  let best = usable[0];
  let bestScore = scoreStream(best, choice);
  for (let index = 1; index < usable.length; index++) {
    const score = scoreStream(usable[index], choice);
    if (score > bestScore) {
      best = usable[index];
      bestScore = score;
    }
  }
  return best;
};

/** "Filepress · 1080p · Hindi" for the choice shown in dialogs and the rule card. */
export const describeChoice = (choice?: SourceChoice): string => {
  if (!choice) return 'First server';
  const parts = [choice.server || 'First server'];
  if (choice.quality && !new RegExp(`${choice.quality}`).test(choice.server || '')) parts.push(`${choice.quality}p`);
  if (choice.language && !new RegExp(choice.language, 'i').test(choice.server || '')) parts.push(choice.language[0].toUpperCase() + choice.language.slice(1));
  return parts.join(' · ');
};

// The last source picked for one episode of a show, so a season download
// starts with the same one selected.
const store = openStore('droid-stream-series-downloads');
const choiceKey = (provider: string, infoUrl: string) => `choice:${provider}:${infoUrl}`;

export const rememberSourceChoice = (infoUrl: string, choice: SourceChoice): void => {
  try {
    store.setString(choiceKey(choice.provider, infoUrl), JSON.stringify(choice));
  } catch {
    // Only a convenience.
  }
};

export const lastSourceChoice = (provider: string, infoUrl: string): SourceChoice | undefined => {
  try {
    const raw = store.getString(choiceKey(provider, infoUrl));
    const parsed = raw ? JSON.parse(raw) : undefined;
    return parsed && typeof parsed.provider === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

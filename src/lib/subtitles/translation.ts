/**
 * Subtitle translation through a service the viewer sets up: a
 * LibreTranslate-compatible server, or DeepL or Google Cloud Translation with
 * the viewer's own API key. Off by default. Nothing is sent until the viewer
 * picks a service and then asks for a translation in the player.
 *
 * Translated tracks are kept per file and language, so a track is translated
 * once. Keys live in an encrypted store.
 */
import {MMKVLoader} from 'react-native-mmkv-storage';
import {cacheStorage, mainStorage} from '../storage/StorageService';
import type {MMKVStore} from '../storage/openStore';
import type {SubtitleCue} from './cueParser';

export type TranslationService = 'off' | 'libretranslate' | 'deepl' | 'google';

export interface TranslationSettings {
  service: TranslationService;
  /** LibreTranslate: the server address, e.g. https://libretranslate.example.org */
  libreUrl: string;
  /** Language code the subtitles are translated into ("en", "de", ...). Empty: the app's subtitle language. */
  target: string;
}

const SETTINGS_KEY = 'subtitle-translation';
export const TRANSLATION_STORE_ID = 'droid-stream-translate';

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {service: 'off', libreUrl: '', target: ''};

export const readTranslationSettings = (): TranslationSettings => {
  const saved = mainStorage.getObject<Partial<TranslationSettings>>(SETTINGS_KEY) || {};
  const service: TranslationService = ['libretranslate', 'deepl', 'google'].includes(String(saved.service))
    ? (saved.service as TranslationService)
    : 'off';
  return {
    service,
    libreUrl: typeof saved.libreUrl === 'string' ? saved.libreUrl : '',
    target: typeof saved.target === 'string' ? saved.target : '',
  };
};

export const writeTranslationSettings = (settings: TranslationSettings): void => {
  mainStorage.setObject(SETTINGS_KEY, settings);
};

let keyStore: MMKVStore | undefined;
const keys = () =>
  (keyStore ||= new MMKVLoader().withInstanceID('droid-stream-translate').withEncryption().recoverOnKeyLoss().initialize() as MMKVStore);

export const readTranslationKey = (service: TranslationService): string => {
  if (service === 'off') return '';
  try {
    return keys().getString(`key.${service}`) || '';
  } catch {
    return '';
  }
};

export const writeTranslationKey = (service: TranslationService, key: string): void => {
  if (service === 'off') return;
  const value = key.trim();
  if (value) keys().setString(`key.${service}`, value);
  else keys().removeItem(`key.${service}`);
};

const hostOf = (url: string) => url.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');

export const TRANSLATION_SERVICE_NAMES: Record<TranslationService, string> = {
  off: 'Off',
  libretranslate: 'LibreTranslate',
  deepl: 'DeepL',
  google: 'Google Cloud Translation',
};

/** Shown wherever a translation is offered, so it is clear where the text goes. */
export const translationServiceLabel = (settings: TranslationSettings): string =>
  settings.service === 'libretranslate' && settings.libreUrl.trim()
    ? `LibreTranslate (${hostOf(settings.libreUrl.trim())})`
    : TRANSLATION_SERVICE_NAMES[settings.service];

/** Why the service cannot be used yet, or undefined when it is ready. */
export const translationProblem = (settings: TranslationSettings, key: string): string | undefined => {
  if (settings.service === 'off') return 'Turn on subtitle translation in Settings > Subtitle style first.';
  if (settings.service === 'libretranslate' && !/^https?:\/\/\S+/i.test(settings.libreUrl.trim())) {
    return 'Add your LibreTranslate server address in Settings > Subtitle style.';
  }
  if ((settings.service === 'deepl' || settings.service === 'google') && !key) {
    return `Add your ${TRANSLATION_SERVICE_NAMES[settings.service]} API key in Settings > Subtitle style.`;
  }
  return undefined;
};

/** DeepL wants upper case and a regional English and Portuguese. */
const deeplTarget = (code: string) => {
  const lower = code.toLowerCase();
  if (lower === 'en') return 'EN-US';
  if (lower === 'pt') return 'PT-BR';
  if (lower === 'zh') return 'ZH-HANS';
  return lower.toUpperCase();
};

export interface TranslationRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

/** The HTTP request that translates [texts] into [target]. */
export const buildTranslationRequest = (
  settings: TranslationSettings,
  key: string,
  texts: string[],
  target: string,
): TranslationRequest => {
  const json = {'Content-Type': 'application/json', Accept: 'application/json'};
  switch (settings.service) {
    case 'deepl': {
      const host = key.trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
      return {
        url: `${host}/v2/translate`,
        method: 'POST',
        headers: {...json, Authorization: `DeepL-Auth-Key ${key.trim()}`},
        body: JSON.stringify({text: texts, target_lang: deeplTarget(target), preserve_formatting: true, split_sentences: 'nonewlines'}),
      };
    }
    case 'google':
      return {
        url: `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key.trim())}`,
        method: 'POST',
        headers: json,
        body: JSON.stringify({q: texts, target: target.toLowerCase(), format: 'text'}),
      };
    case 'libretranslate':
      return {
        url: `${settings.libreUrl.trim().replace(/\/+$/, '')}/translate`,
        method: 'POST',
        headers: json,
        body: JSON.stringify({q: texts, source: 'auto', target: target.toLowerCase(), format: 'text', ...(key ? {api_key: key.trim()} : {})}),
      };
    default:
      throw new Error('Subtitle translation is off');
  }
};

/** The translated texts in the order sent. Throws when the answer does not have one per text. */
export const parseTranslationResponse = (service: TranslationService, data: unknown, count: number): string[] => {
  const body = (data || {}) as Record<string, any>;
  let texts: unknown[] | undefined;
  if (service === 'deepl') texts = Array.isArray(body.translations) ? body.translations.map((item: any) => item?.text) : undefined;
  else if (service === 'google') texts = Array.isArray(body.data?.translations) ? body.data.translations.map((item: any) => item?.translatedText) : undefined;
  else if (Array.isArray(body.translatedText)) texts = body.translatedText;
  else if (typeof body.translatedText === 'string' && count === 1) texts = [body.translatedText];
  if (!texts || texts.length !== count || texts.some(text => typeof text !== 'string')) {
    const message = typeof body.error === 'string' ? body.error : body.message || body.error?.message;
    throw new Error(message ? `Translation failed: ${message}` : 'The translation service gave an answer the app cannot read');
  }
  return (texts as string[]).map(text => text.replace(/\r\n?/g, '\n').trim());
};

/** Groups of texts small enough for one request: DeepL takes 50 texts, Google 128. */
export const translationBatches = (texts: string[], service: TranslationService, maxChars = 4500): number[][] => {
  const maxItems = service === 'deepl' ? 50 : service === 'google' ? 100 : 40;
  const batches: number[][] = [];
  let current: number[] = [];
  let chars = 0;
  texts.forEach((text, index) => {
    if (current.length && (current.length >= maxItems || chars + text.length > maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(index);
    chars += text.length;
  });
  if (current.length) batches.push(current);
  return batches;
};

// Cache of translated tracks

const CACHE_INDEX_KEY = 'subtr:index';
const MAX_CACHED_TRACKS = 20;

interface CachedTranslation {
  /** Translated text per cue, empty where not translated yet. */
  texts: string[];
  at: number;
}

const hash = (text: string) => {
  let value = 5381;
  // eslint-disable-next-line no-bitwise -- djb2
  for (let index = 0; index < text.length; index++) value = ((value * 33) ^ text.charCodeAt(index)) >>> 0;
  return value.toString(36);
};

/** One key per file, track, line count, service and language. */
export const translationCacheKey = (trackKey: string, cues: SubtitleCue[], settings: TranslationSettings, target: string): string => {
  const shape = `${cues.length}:${Math.round(cues[0]?.start || 0)}:${Math.round(cues[cues.length - 1]?.end || 0)}`;
  return `subtr:${hash(`${trackKey}|${shape}`)}:${settings.service}:${target.toLowerCase()}`;
};

export const readCachedTranslation = (key: string, count: number): string[] | undefined => {
  const entry = cacheStorage.getObject<CachedTranslation>(key);
  return entry && Array.isArray(entry.texts) && entry.texts.length === count ? entry.texts : undefined;
};

export const writeCachedTranslation = (key: string, texts: string[], now = Date.now()): void => {
  cacheStorage.setObject<CachedTranslation>(key, {texts, at: now});
  const index = (cacheStorage.getArray<string>(CACHE_INDEX_KEY) || []).filter(item => item !== key);
  index.push(key);
  while (index.length > MAX_CACHED_TRACKS) cacheStorage.delete(index.shift()!);
  cacheStorage.setArray(CACHE_INDEX_KEY, index);
};

/** Batch order that starts where the viewer is, then wraps to the beginning. */
export const batchOrderFrom = (batches: number[][], cues: SubtitleCue[], time: number): number[][] => {
  const first = batches.findIndex(batch => cues[batch[batch.length - 1]]?.end >= time);
  return first <= 0 ? batches : [...batches.slice(first), ...batches.slice(0, first)];
};

export interface TranslateOptions {
  settings: TranslationSettings;
  key: string;
  target: string;
  cacheKey: string;
  /** Video time; lines from here on are translated first. */
  fromTime?: number;
  signal?: {aborted: boolean};
  onProgress?: (texts: string[], done: number, total: number) => void;
  fetchImpl?: typeof fetch;
}

/**
 * Translates every cue, keeping what was already translated for this track.
 * Progress is saved after each batch, so a stopped translation continues
 * where it was.
 */
export const translateCues = async (cues: SubtitleCue[], options: TranslateOptions): Promise<string[]> => {
  const {settings, key, target, cacheKey, signal, onProgress} = options;
  const doFetch = options.fetchImpl || fetch;
  const texts = readCachedTranslation(cacheKey, cues.length) || cues.map(() => '');
  const pending = cues.map((_cue, index) => index).filter(index => !texts[index] && cues[index].text);
  const total = cues.length;
  let done = total - pending.length;
  onProgress?.(texts, done, total);
  if (!pending.length) return texts;
  const pendingTexts = pending.map(index => cues[index].text);
  const batches = batchOrderFrom(
    translationBatches(pendingTexts, settings.service).map(batch => batch.map(position => pending[position])),
    cues,
    options.fromTime || 0,
  );
  for (const batch of batches) {
    if (signal?.aborted) break;
    const request = buildTranslationRequest(settings, key, batch.map(index => cues[index].text), target);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let data: unknown;
    try {
      const response = await doFetch(request.url, {method: request.method, headers: request.headers, body: request.body, signal: controller.signal});
      data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const body = data as Record<string, any>;
        const message = typeof body?.error === 'string' ? body.error : body?.message || body?.error?.message;
        if (response.status === 401 || response.status === 403) throw new Error('The translation service did not accept the API key');
        if (response.status === 429 || response.status === 456) throw new Error('The translation service limit was reached. Try again later.');
        throw new Error(message ? `Translation failed: ${message}` : `Translation failed (HTTP ${response.status})`);
      }
    } finally {
      clearTimeout(timer);
    }
    const translated = parseTranslationResponse(settings.service, data, batch.length);
    batch.forEach((index, position) => {
      texts[index] = translated[position] || cues[index].text;
    });
    done += batch.length;
    writeCachedTranslation(cacheKey, texts);
    onProgress?.(texts, done, total);
  }
  return texts;
};

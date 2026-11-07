/* eslint-disable no-bitwise -- byte-level decoding and hashing */
/**
 * Loads an XMLTV guide for the programme guide screen. The file is downloaded
 * natively to the cache folder, then read back in 1 MB pieces (gunzipped on
 * the fly when it is .gz) and parsed as it streams, pausing between pieces so
 * the screen stays responsive. The parsed result is kept as JSON next to the
 * download and reused for 12 hours.
 */
import * as RNFS from '@dr.pogodin/react-native-fs';
import {toByteArray} from 'base64-js';
import {DAY, type GuideProgramme} from './guide';
import {Inflater, isGzip} from './inflate';
import {readLiveJson, writeLiveJson} from './store';
import {Utf8Stream} from './utf8';
import {channelNameKeys, XmltvParser, type XmltvOptions, type XmltvResult} from './xmltv';

export const GUIDE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 250 * 1024 * 1024;
const READ_CHUNK = 1024 * 1024;
/** Programmes kept after now. */
const FORWARD_MS = 3 * DAY;

export interface GuideData extends XmltvResult {
  url: string;
  fetchedAt: number;
}

interface GuideMeta {
  url: string;
  fetchedAt: number;
  filter: string;
}

const dir = () => `${RNFS.CachesDirectoryPath}/livetv-guide`;

/** Short, stable file name for a text. */
export const hashText = (text: string) => {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = (h1 * 33) ^ c;
    h2 = (h2 * 33) ^ c;
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
};

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const readChunk = async (path: string, length: number, position: number): Promise<Uint8Array> =>
  toByteArray(await RNFS.read(path, length, position, 'base64'));

/** Streams a downloaded guide file (plain or gzipped XML) through the XMLTV parser. */
export const parseGuideFile = async (path: string, options: XmltvOptions, maxBytes = MAX_FILE_BYTES): Promise<XmltvResult> => {
  const size = Number((await RNFS.stat(path)).size) || 0;
  if (size > maxBytes) throw new Error('This guide file is too large.');
  const parser = new XmltvParser(options);
  const utf8 = new Utf8Stream();
  const first = await readChunk(path, Math.min(size, READ_CHUNK), 0);
  if (isGzip(first)) {
    const compressed = new Uint8Array(size);
    compressed.set(first);
    for (let pos = first.length; pos < size; pos += READ_CHUNK) {
      compressed.set(await readChunk(path, Math.min(READ_CHUNK, size - pos), pos), pos);
    }
    const inflater = new Inflater(compressed, READ_CHUNK);
    for (let chunk = inflater.read(); chunk; chunk = inflater.read()) {
      parser.push(utf8.decode(chunk));
      await tick();
    }
  } else {
    parser.push(utf8.decode(first));
    for (let pos = first.length; pos < size; pos += READ_CHUNK) {
      await tick();
      parser.push(utf8.decode(await readChunk(path, Math.min(READ_CHUNK, size - pos), pos)));
    }
  }
  parser.push(utf8.decode(new Uint8Array(0), true));
  return parser.finish();
};

const download = async (url: string, toFile: string) => {
  await RNFS.mkdir(dir()).catch(() => undefined);
  const part = `${toFile}.part`;
  let status = 0;
  try {
    const job = RNFS.downloadFile({
      fromUrl: url,
      toFile: part,
      headers: {Accept: 'application/xml, text/xml, application/gzip, */*'},
      connectionTimeout: 20_000,
      readTimeout: 60_000,
    });
    status = (await job.promise).statusCode;
  } catch {
    throw new Error('Could not download the guide. Check the address and your connection.');
  }
  if (status >= 400) {
    await RNFS.unlink(part).catch(() => undefined);
    throw new Error(`The guide server answered ${status}.`);
  }
  await RNFS.unlink(toFile).catch(() => undefined);
  await RNFS.moveFile(part, toFile);
  await pruneGuideFiles().catch(() => undefined);
};

/** Downloaded guide files kept; World countries each have their own, so old ones go. */
const KEEP_GUIDE_FILES = 8;

/** Deletes the oldest downloaded guides (and their parsed copies) past KEEP_GUIDE_FILES. */
const pruneGuideFiles = async () => {
  const items = (await RNFS.readDir(dir())) || [];
  const raw = items
    .filter(item => item.name.endsWith('.xml'))
    .sort((a, b) => Number(b.mtime || 0) - Number(a.mtime || 0));
  for (const old of raw.slice(KEEP_GUIDE_FILES)) {
    await RNFS.unlink(old.path).catch(() => undefined);
    await RNFS.unlink(old.path.replace(/\.xml$/, '.json')).catch(() => undefined);
  }
};

export interface GuideRequest {
  /** tvg-id values of the channels shown. */
  ids: string[];
  /** Normalised channel names, matched against display-name. */
  names: string[];
  /** How far back to keep programmes, for catch-up. */
  backMs: number;
}

const readCachedResult = async (path: string): Promise<XmltvResult | undefined> => {
  try {
    if (!(await RNFS.exists(path))) return undefined;
    return JSON.parse(await RNFS.readFile(path, 'utf8')) as XmltvResult;
  } catch {
    return undefined;
  }
};

const cacheInfo = (url: string, request: GuideRequest) => {
  const key = hashText(url);
  const backDays = Math.ceil(request.backMs / DAY);
  return {
    rawPath: `${dir()}/${key}.xml`,
    jsonPath: `${dir()}/${key}.json`,
    metaKey: `epgmeta:${key}`,
    backDays,
    filter: hashText(`${backDays}|${[...request.ids].sort().join(',')}|${[...request.names].sort().join(',')}`),
  };
};

/**
 * The guide for these channels only when it is already in the 12-hour cache
 * for the same channels; never downloads. For the now / next line on
 * devices with little memory.
 */
export const peekXmltvGuide = async (url: string, request: GuideRequest): Promise<GuideData | undefined> => {
  const {jsonPath, metaKey, filter} = cacheInfo(url, request);
  const meta = readLiveJson<GuideMeta>(metaKey);
  if (!meta || meta.url !== url || meta.filter !== filter || Date.now() - meta.fetchedAt >= GUIDE_MAX_AGE_MS) return undefined;
  const cached = await readCachedResult(jsonPath);
  return cached ? {...cached, url, fetchedAt: meta.fetchedAt} : undefined;
};

/**
 * The guide for these channels, from the 12-hour cache when it is fresh
 * enough. `maxBytes` caps the downloaded file (gzipped size when gzipped).
 */
export const loadXmltvGuide = async (
  url: string,
  request: GuideRequest,
  {force = false, maxBytes = MAX_FILE_BYTES}: {force?: boolean; maxBytes?: number} = {},
): Promise<GuideData> => {
  const {rawPath, jsonPath, metaKey, backDays, filter} = cacheInfo(url, request);
  const now = Date.now();
  const meta = readLiveJson<GuideMeta>(metaKey);
  const fresh = !!meta && !force && meta.url === url && now - meta.fetchedAt < GUIDE_MAX_AGE_MS;

  if (fresh && meta!.filter === filter) {
    const cached = await readCachedResult(jsonPath);
    if (cached) return {...cached, url, fetchedAt: meta!.fetchedAt};
  }
  let fetchedAt = meta?.fetchedAt || now;
  if (!fresh || !(await RNFS.exists(rawPath))) {
    await download(url, rawPath);
    fetchedAt = Date.now();
  }
  const result = await parseGuideFile(rawPath, {
    from: now - backDays * DAY,
    to: now + FORWARD_MS,
    ids: new Set(request.ids),
    names: new Set(request.names),
  }, maxBytes);
  await RNFS.writeFile(jsonPath, JSON.stringify(result), 'utf8').catch(() => undefined);
  writeLiveJson(metaKey, {url, fetchedAt, filter} satisfies GuideMeta);
  return {...result, url, fetchedAt};
};

/** The programme list for a channel: by tvg-id first, then by name. */
export const programmesFor = (
  guide: XmltvResult | undefined,
  channel: {tvgId?: string; tvgName?: string; name: string},
  normalize: (name: string) => string,
): GuideProgramme[] | undefined => {
  if (!guide) return undefined;
  if (channel.tvgId && guide.programmes[channel.tvgId]) return guide.programmes[channel.tvgId];
  for (const name of [channel.tvgName, channel.name]) {
    const id = name ? guide.names[normalize(name)] : undefined;
    if (id && guide.programmes[id]) return guide.programmes[id];
  }
  // Names without tags, then the tvg-id read as a name (guides with their own ids).
  for (const key of channelNameKeys(channel)) {
    const id = guide.names[key];
    if (id && guide.programmes[id]) return guide.programmes[id];
  }
  return undefined;
};

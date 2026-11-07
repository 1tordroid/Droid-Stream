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
import {XmltvParser, type XmltvOptions, type XmltvResult} from './xmltv';

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
export const parseGuideFile = async (path: string, options: XmltvOptions): Promise<XmltvResult> => {
  const size = Number((await RNFS.stat(path)).size) || 0;
  if (size > MAX_FILE_BYTES) throw new Error('This guide file is too large.');
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

/** The guide for these channels, from the 12-hour cache when it is fresh enough. */
export const loadXmltvGuide = async (url: string, request: GuideRequest, {force = false} = {}): Promise<GuideData> => {
  const key = hashText(url);
  const rawPath = `${dir()}/${key}.xml`;
  const jsonPath = `${dir()}/${key}.json`;
  const metaKey = `epgmeta:${key}`;
  const backDays = Math.ceil(request.backMs / DAY);
  const filter = hashText(`${backDays}|${[...request.ids].sort().join(',')}|${[...request.names].sort().join(',')}`);
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
  });
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
  return undefined;
};

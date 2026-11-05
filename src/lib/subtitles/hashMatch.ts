/* eslint-disable no-bitwise -- 64-bit hash arithmetic */
/**
 * Subtitles matched to the exact file. Computes the OpenSubtitles hash
 * (file size + 64-bit sums of the first and last 64 KiB) over HTTP ranges, so
 * it works for debrid links and the local torrent stream as well as files.
 */
import {Buffer} from 'buffer';
import {fetchAddonSubtitles, findImdb, readAddons, videoId, type StremioSubtitle} from '../stremio';
import type {WatchMeta} from '../watchMeta';

const CHUNK = 65536;
export const OPENSUBTITLES_V3 = 'https://opensubtitles-v3.strem.io';

/** OpenSubtitles hash from the file size and its first and last 64 KiB. */
export const opensubtitlesHash = (size: number, head: Uint8Array, tail: Uint8Array): string => {
  // 64-bit arithmetic with two 32-bit halves (works without BigInt).
  let lo = size >>> 0;
  let hi = Math.floor(size / 4294967296) >>> 0;
  const add = (bytes: Uint8Array) => {
    for (let i = 0; i + 8 <= bytes.length; i += 8) {
      const wordLo = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
      const wordHi = (bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)) >>> 0;
      const sumLo = lo + wordLo;
      lo = sumLo >>> 0;
      hi = (hi + wordHi + (sumLo > 0xffffffff ? 1 : 0)) >>> 0;
    }
  };
  add(head);
  add(tail);
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
};

const rangeBytes = async (url: string, start: number, end: number, headers?: Record<string, string>): Promise<{bytes: Uint8Array; total?: number}> => {
  const response = await fetch(url, {headers: {...headers, Range: `bytes=${start}-${end}`}});
  if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
  const total = Number(response.headers.get('content-range')?.split('/')[1]) || undefined;
  const buffer = await response.arrayBuffer();
  return {bytes: new Uint8Array(buffer).slice(0, end - start + 1), total};
};

export const hashRemoteFile = async (url: string, headers?: Record<string, string>): Promise<{hash: string; size: number}> => {
  const first = await rangeBytes(url, 0, CHUNK - 1, headers);
  const size = first.total;
  if (!size || size < CHUNK * 2) throw new Error('The server does not report the file size, so it cannot be matched by hash');
  const last = await rangeBytes(url, size - CHUNK, size - 1, headers);
  return {hash: opensubtitlesHash(size, first.bytes, last.bytes), size};
};

export const hashLocalFile = async (path: string): Promise<{hash: string; size: number}> => {
  const RNFS = require('@dr.pogodin/react-native-fs');
  const clean = decodeURIComponent(path.replace(/^file:\/\//, ''));
  const stat = await RNFS.stat(clean);
  const size = Number(stat.size);
  const head = Buffer.from(await RNFS.read(clean, CHUNK, 0, 'base64'), 'base64');
  const tail = Buffer.from(await RNFS.read(clean, CHUNK, size - CHUNK, 'base64'), 'base64');
  return {hash: opensubtitlesHash(size, new Uint8Array(head), new Uint8Array(tail)), size};
};

export interface MatchedSubtitle extends StremioSubtitle {
  addon: string;
  /** True when the subtitle was matched to this exact file. */
  exact: boolean;
}

const LANG_NAMES: Record<string, string> = {
  eng: 'English', hin: 'Hindi', spa: 'Spanish', fre: 'French', fra: 'French', ger: 'German', deu: 'German', ita: 'Italian', por: 'Portuguese',
  pob: 'Portuguese (BR)', rus: 'Russian', ara: 'Arabic', jpn: 'Japanese', kor: 'Korean', chi: 'Chinese', zho: 'Chinese', tur: 'Turkish', pol: 'Polish',
  dut: 'Dutch', nld: 'Dutch', ind: 'Indonesian', vie: 'Vietnamese', tha: 'Thai', tam: 'Tamil', tel: 'Telugu', ben: 'Bengali', urd: 'Urdu', may: 'Malay',
};
export const languageName = (code: string): string => LANG_NAMES[code?.toLowerCase()] || code;

/**
 * Finds subtitles for what is playing: by file hash when the file can be
 * read, and by IMDb id plus season and episode otherwise.
 */
export const findMatchedSubtitles = async (input: {url?: string; headers?: Record<string, string>; meta?: WatchMeta; filename?: string}): Promise<MatchedSubtitle[]> => {
  const meta = input.meta;
  if (!meta?.title) throw new Error('The title of this video is unknown');
  let imdbId = meta.imdbId;
  if (!imdbId) imdbId = (await findImdb(meta.title, meta.type, meta.year).catch(() => undefined))?.id;
  if (!imdbId) throw new Error(`Could not identify "${meta.title}"`);

  let hint: {videoHash?: string; videoSize?: number} = {};
  if (input.url) {
    try {
      const result = /^(\/|file:)/.test(input.url) ? await hashLocalFile(input.url) : await hashRemoteFile(input.url, input.headers);
      hint = {videoHash: result.hash, videoSize: result.size};
    } catch {
      // Fall back to title matching.
    }
  }
  const id = videoId(imdbId, meta.type === 'series' ? meta.season : undefined, meta.type === 'series' ? meta.episode : undefined);
  const type = meta.type === 'series' ? 'series' : 'movie';
  let found = await fetchAddonSubtitles(type, id, {...hint, filename: input.filename});
  // OpenSubtitles v3 is free and needs no key; use it even when not installed.
  if (!readAddons().some(addon => addon.base === OPENSUBTITLES_V3)) {
    const extra = [hint.videoHash ? `videoHash=${hint.videoHash}` : '', hint.videoSize ? `videoSize=${hint.videoSize}` : ''].filter(Boolean).join('&');
    try {
      const response = await fetch(`${OPENSUBTITLES_V3}/subtitles/${type}/${encodeURIComponent(id)}${extra ? `/${extra}` : ''}.json`);
      const data = await response.json();
      found = [...found, ...(data?.subtitles || []).map((sub: StremioSubtitle) => ({...sub, addon: 'OpenSubtitles'}))];
    } catch {
      // ignore
    }
  }
  const seen = new Set<string>();
  return found
    .filter(sub => sub.url && !seen.has(sub.url) && seen.add(sub.url))
    .map(sub => ({...sub, exact: Boolean(hint.videoHash)}));
};

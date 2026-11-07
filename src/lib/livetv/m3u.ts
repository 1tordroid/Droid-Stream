/**
 * M3U / M3U8 IPTV playlist parser. Pure: no React Native imports, so it runs
 * in unit tests and can be reused anywhere a playlist text is at hand.
 *
 * Understands:
 * - #EXTM3U header attributes (url-tvg, x-tvg-url) for the EPG address.
 * - #EXTINF:<duration> key="value" ...,<title> with tvg-id, tvg-name,
 *   tvg-logo, group-title and any other attribute (quoted or bare).
 * - #EXTVLCOPT:http-user-agent= / http-referrer= (also http-origin) as headers.
 * - #EXTGRP as a fallback group.
 * - #KODIPROP and other unknown # lines are skipped.
 * - BOM, CRLF / CR line endings, blank lines, missing attributes.
 */
import {parseResolution} from './filters';

import {isDrmOption} from '../downloadEngine/recordable';

export interface LiveChannel {
  /** Stable id: tvg-id when present, else the stream URL. */
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  tvgName?: string;
  /** Picture quality from the name or attributes ("1080p", "4K", "HD"); the name is kept as is. */
  resolution?: string;
  /** Request headers the stream needs (User-Agent, Referer, Origin). */
  headers?: Record<string, string>;
  /** All attributes from the #EXTINF line, lower-cased keys. */
  attrs: Record<string, string>;
  /** The entry has a DRM licence option (#KODIPROP or #EXTVLCOPT), so it cannot be recorded. */
  drm?: boolean;
}

export interface ParsedPlaylist {
  channels: LiveChannel[];
  /** XMLTV guide address from the #EXTM3U header, when given. */
  epgUrl?: string;
}

const ATTR = /([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,"']+))/g;

/** Reads key="value" pairs from an attribute string. */
export const parseAttributes = (text: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR.exec(text))) {
    attrs[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? '').trim();
  }
  return attrs;
};

/** Finds the comma that ends the attribute list (commas inside quotes do not count). */
const titleComma = (text: string): number => {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ',') {
      return i;
    }
  }
  return -1;
};

const HEADER_OPTS: Record<string, string> = {
  'http-user-agent': 'User-Agent',
  'http-referrer': 'Referer',
  'http-referer': 'Referer',
  'http-origin': 'Origin',
};

/** Pulls pipe-style headers off a URL: `url|User-Agent=x&Referer=y` (Kodi style). */
const splitPipeHeaders = (raw: string): {url: string; headers: Record<string, string>} => {
  const pipe = raw.indexOf('|');
  if (pipe < 0) return {url: raw, headers: {}};
  const headers: Record<string, string> = {};
  for (const part of raw.slice(pipe + 1).split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep the raw value
    }
    const lower = key.toLowerCase();
    const name = lower === 'user-agent' ? 'User-Agent' : lower === 'referer' || lower === 'referrer' ? 'Referer' : lower === 'origin' ? 'Origin' : key;
    if (value) headers[name] = value;
  }
  return {url: raw.slice(0, pipe).trim(), headers};
};

type Pending = {name: string; attrs: Record<string, string>; group?: string; headers: Record<string, string>; drm?: boolean};

/**
 * Reads a playlist one line at a time, so a large one can be fed in pieces
 * (with pauses between them) and each channel handed on as soon as its URL
 * line is read. parseM3U below uses it for a whole text.
 */
export class M3uParser {
  epgUrl?: string;
  private pending: Pending | null = null;
  private readonly seen = new Set<string>();
  private rest = '';

  /** `emit` gets each channel; `uniqueIds: false` skips the duplicate-id check (and its memory). */
  constructor(
    private readonly emit: (channel: LiveChannel) => void,
    private readonly options: {uniqueIds?: boolean} = {},
  ) {}

  /** Feeds a piece of text that may end in the middle of a line. */
  push(text: string) {
    const lines = (this.rest + text).split(/\r\n|\r|\n/);
    this.rest = lines.pop() || '';
    for (const line of lines) this.line(line);
  }

  /** Reads what is left. */
  end() {
    if (this.rest) this.line(this.rest);
    this.rest = '';
  }

  line(rawLine: string) {
    const line = rawLine.replace(/^﻿/, '').trim();
    if (!line) return;
    if (line.startsWith('#')) {
      const upper = line.slice(0, 12).toUpperCase();
      if (upper.startsWith('#EXTM3U')) {
        const attrs = parseAttributes(line.slice(7));
        const guide = attrs['url-tvg'] || attrs['x-tvg-url'] || attrs['tvg-url'];
        // Several guides may be listed with commas; the first is enough.
        if (guide && !this.epgUrl) this.epgUrl = guide.split(',')[0].trim() || undefined;
      } else if (upper.startsWith('#EXTINF:')) {
        const body = line.slice(8);
        const comma = titleComma(body);
        const attrPart = comma >= 0 ? body.slice(0, comma) : body;
        const title = comma >= 0 ? body.slice(comma + 1).trim() : '';
        // Drop the leading duration ("-1" or "0").
        const attrs = parseAttributes(attrPart.replace(/^\s*-?\d+(\.\d+)?/, ''));
        this.pending = {name: title, attrs, headers: {}};
      } else if (upper.startsWith('#EXTVLCOPT:')) {
        const opt = line.slice(11);
        const eq = opt.indexOf('=');
        if (eq > 0) {
          const header = HEADER_OPTS[opt.slice(0, eq).trim().toLowerCase()];
          const value = opt.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
          if (header && value) this.open().headers[header] = value;
        }
      } else if (upper.startsWith('#EXTGRP:')) {
        const group = line.slice(8).trim();
        if (group) this.open().group = group;
      }
      // A licence option (Widevine, PlayReady, ClearKey) marks the entry as DRM.
      if ((upper.startsWith('#KODIPROP:') || upper.startsWith('#EXTVLCOPT:')) && isDrmOption(line)) this.open().drm = true;
      // Other #KODIPROP, #EXT-X-*, comments: ignored.
      return;
    }
    // A URL line closes the entry.
    const pending = this.pending;
    this.pending = null;
    const {url, headers: pipeHeaders} = splitPipeHeaders(line);
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return;
    const attrs = pending?.attrs || {};
    const tvgId = attrs['tvg-id'] || undefined;
    const tvgName = attrs['tvg-name'] || undefined;
    const name = pending?.name || tvgName || url;
    const headers = {...pipeHeaders, ...(pending?.headers || {})};
    if (attrs['user-agent'] && !headers['User-Agent']) headers['User-Agent'] = attrs['user-agent'];
    if (attrs['http-referrer'] && !headers.Referer) headers.Referer = attrs['http-referrer'];
    let id = tvgId ? `${tvgId}|${url}` : url;
    if (this.options.uniqueIds !== false) {
      if (this.seen.has(id)) {
        let n = 2;
        while (this.seen.has(`${id}#${n}`)) n++;
        id = `${id}#${n}`;
      }
      this.seen.add(id);
    }
    this.emit({
      id,
      name,
      url,
      logo: attrs['tvg-logo'] || attrs.logo || undefined,
      group: attrs['group-title'] || pending?.group || undefined,
      tvgId,
      tvgName,
      resolution: parseResolution(name, attrs, tvgId),
      headers: Object.keys(headers).length ? headers : undefined,
      attrs,
      ...(pending?.drm ? {drm: true} : {}),
    });
  }

  private open(): Pending {
    if (!this.pending) this.pending = {name: '', attrs: {}, headers: {}};
    return this.pending;
  }
}

export const parseM3U = (input: string): ParsedPlaylist => {
  const channels: LiveChannel[] = [];
  const parser = new M3uParser(channel => channels.push(channel));
  for (const line of (input || '').split(/\r\n|\r|\n/)) parser.line(line);
  return {channels, epgUrl: parser.epgUrl};
};

/** Groups in playlist order, each once. Channels without a group are left out. */
type Groupable = Pick<LiveChannel, 'name' | 'group'> & {tvgName?: string};

export const channelGroups = (channels: Groupable[]): string[] => {
  const groups: string[] = [];
  const seen = new Set<string>();
  for (const channel of channels) {
    // iptv-org lists several groups with ';'.
    for (const group of (channel.group || '').split(';')) {
      const name = group.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        groups.push(name);
      }
    }
  }
  return groups;
};

export const inGroup = (channel: Groupable, group: string): boolean =>
  (channel.group || '').split(';').some(item => item.trim() === group);

/** Case-insensitive search over name, group and tvg-name. */
export const filterChannels = <T extends Groupable>(channels: T[], query: string, group?: string): T[] => {
  const q = query.trim().toLowerCase();
  return channels.filter(channel => {
    if (group && !inGroup(channel, group)) return false;
    if (!q) return true;
    return `${channel.name} ${channel.group || ''} ${channel.tvgName || ''}`.toLowerCase().includes(q);
  });
};

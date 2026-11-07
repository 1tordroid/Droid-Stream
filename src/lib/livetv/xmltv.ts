/**
 * Streaming XMLTV reader for the programme guide. Text goes in piece by
 * piece; each complete <channel> or <programme> element is read and dropped,
 * so only the programmes inside the wanted time range and for the wanted
 * channels are kept.
 */
import {parseXmltvTime} from './epg';
import {cleanProgrammes, type GuideProgramme} from './guide';

export interface XmltvOptions {
  /** Keep programmes that end after this time. */
  from: number;
  /** Keep programmes that start before this time. */
  to: number;
  /** XMLTV channel ids to keep (tvg-id). All channels when left out. */
  ids?: Set<string>;
  /** Normalised channel names to match by display-name when the id is not in `ids`. */
  names?: Set<string>;
  /** Longest description kept, in characters. */
  maxDesc?: number;
}

export interface XmltvResult {
  programmes: Record<string, GuideProgramme[]>;
  /** Normalised display-name to XMLTV channel id. */
  names: Record<string, string>;
}

/** Lower case, letters and digits only, a trailing "hd" dropped: "Star Sports 1 HD" -> "starsports1". */
export const normalizeChannelName = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9À-￿]+/g, '')
    .replace(/(.)(?:hd|fhd|uhd|4k)$/, '$1');

/**
 * A channel id as a name: "BBCOne.uk@SD" (iptv-org) and "BBC.One.HD.uk"
 * (guide sites) both give "bbcone". The feed after "@" and a two-letter
 * country ending are dropped first.
 */
export const channelIdKey = (id: string) => normalizeChannelName(id.replace(/@.*$/, '').replace(/\.[a-z]{2}$/i, ''));

const TAGS = /\s*[([][^)\]]*[)\]]/g;

/**
 * The names a playlist channel may have in a guide: its name and tvg-name
 * (also without tags like "(1080p)" or "[Geo-blocked]"), then its tvg-id as
 * a name. Used when the guide's ids are not the playlist's.
 */
export const channelNameKeys = (channel: {name: string; tvgName?: string; tvgId?: string}): string[] => {
  const keys: string[] = [];
  const add = (key: string) => {
    if (key && !keys.includes(key)) keys.push(key);
  };
  for (const name of [channel.tvgName, channel.name]) {
    if (!name) continue;
    add(normalizeChannelName(name));
    add(normalizeChannelName(name.replace(TAGS, '')));
  }
  if (channel.tvgId) add(channelIdKey(channel.tvgId));
  return keys;
};

const ENTITIES: Record<string, string> = {lt: '<', gt: '>', quot: '"', apos: "'", amp: '&', nbsp: ' '};

export const decodeXmlText = (text: string) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .trim();

const attrOf = (tag: string, name: string): string => {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(` ${tag}`);
  return match ? decodeXmlText(match[1] ?? match[2] ?? '') : '';
};

const childText = (body: string, tag: string): string => {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(body);
  return match ? decodeXmlText(match[1]) : '';
};

const ELEMENT = /<(programme|channel)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1\s*>)/g;
/** Text held back while waiting for an element to finish; more means broken XML. */
const MAX_PENDING = 4 * 1024 * 1024;

export class XmltvParser {
  private buffer = '';
  private readonly programmes = new Map<string, GuideProgramme[]>();
  private readonly names: Record<string, string> = {};
  private readonly ids: Set<string> | undefined;
  private count = 0;

  constructor(private readonly options: XmltvOptions) {
    this.ids = options.ids ? new Set(options.ids) : undefined;
  }

  /** Number of programmes kept so far. */
  get size() {
    return this.count;
  }

  push(text: string) {
    this.buffer += text;
    ELEMENT.lastIndex = 0;
    let end = 0;
    let match: RegExpExecArray | null;
    while ((match = ELEMENT.exec(this.buffer))) {
      end = ELEMENT.lastIndex;
      if (match[1] === 'channel') this.channel(match[2], match[3] || '');
      else this.programme(match[2], match[3] || '');
    }
    if (end) {
      this.buffer = this.buffer.slice(end);
    } else if (this.buffer.length > MAX_PENDING) {
      const open = this.buffer.lastIndexOf('<');
      this.buffer = open > 0 ? this.buffer.slice(open) : '';
    }
    // Drop text before the next element start (headers, whitespace).
    const next = this.buffer.search(/<(?:programme|channel)\b/);
    if (next > 0) this.buffer = this.buffer.slice(next);
    else if (next < 0 && this.buffer.length > 64) this.buffer = this.buffer.slice(-64);
  }

  private channel(attrs: string, body: string) {
    const id = attrOf(attrs, 'id');
    if (!id) return;
    const re = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(body))) {
      const name = normalizeChannelName(decodeXmlText(match[1]));
      if (!name) continue;
      const wanted = !this.options.names || this.options.names.has(name);
      if (!wanted) continue;
      if (!(name in this.names)) this.names[name] = id;
      // Matched by name: keep its programmes too.
      this.ids?.add(id);
    }
    // Guide ids like "BBC.One.HD.uk" also match a playlist's "BBCOne.uk@SD" as a name.
    const key = this.options.names ? channelIdKey(id) : '';
    if (key && this.options.names!.has(key)) {
      if (!(key in this.names)) this.names[key] = id;
      this.ids?.add(id);
    }
  }

  private programme(attrs: string, body: string) {
    const channel = attrOf(attrs, 'channel');
    if (!channel || (this.ids && !this.ids.has(channel))) return;
    const start = parseXmltvTime(attrOf(attrs, 'start'));
    const stop = parseXmltvTime(attrOf(attrs, 'stop'));
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) return;
    if (stop <= this.options.from || start >= this.options.to) return;
    const title = childText(body, 'title');
    if (!title) return;
    const programme: GuideProgramme = {start, stop, title};
    const maxDesc = this.options.maxDesc ?? 240;
    const desc = maxDesc > 0 ? childText(body, 'desc') : '';
    if (desc) programme.desc = desc.length > maxDesc ? `${desc.slice(0, maxDesc - 1).trimEnd()}…` : desc;
    const catchupId = attrOf(attrs, 'catchup-id');
    if (catchupId) programme.catchupId = catchupId;
    let list = this.programmes.get(channel);
    if (!list) {
      list = [];
      this.programmes.set(channel, list);
    }
    list.push(programme);
    this.count++;
  }

  finish(): XmltvResult {
    this.push('');
    this.buffer = '';
    const programmes: Record<string, GuideProgramme[]> = {};
    for (const [id, list] of this.programmes) programmes[id] = cleanProgrammes(list);
    return {programmes, names: {...this.names}};
  }
}

/** Parses a whole XMLTV text at once. */
export const parseXmltv = (xml: string, options: XmltvOptions): XmltvResult => {
  const parser = new XmltvParser(options);
  parser.push(xml);
  return parser.finish();
};

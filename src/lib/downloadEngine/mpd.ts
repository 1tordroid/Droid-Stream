/**
 * MPEG-DASH manifest (MPD) reader for static, unencrypted VOD. Pure: no React
 * Native imports, so it runs in unit tests.
 *
 * Handles SegmentTemplate ($Number$, $Time$, $RepresentationID$, $Bandwidth$,
 * printf widths, SegmentTimeline with repeats), SegmentList, SegmentBase and
 * plain BaseURL single files, inherited from Period, AdaptationSet and
 * Representation. Live (dynamic) manifests and any ContentProtection are refused.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};

export const decodeXmlEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });

/** Drops a namespace prefix: `mpd:Period` becomes `Period`. */
const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** A small XML reader: elements, attributes and text. Enough for MPD files. */
export const parseXml = (source: string): XmlNode => {
  const root: XmlNode = {name: '#document', attrs: {}, children: [], text: ''};
  const stack: XmlNode[] = [root];
  const text = source.replace(/^﻿/, '');
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open < 0) {
      stack[stack.length - 1].text += decodeXmlEntities(text.slice(index));
      break;
    }
    if (open > index) stack[stack.length - 1].text += decodeXmlEntities(text.slice(index, open));
    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4);
      index = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9);
      stack[stack.length - 1].text += text.slice(open + 9, end < 0 ? text.length : end);
      index = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<?', open) || text.startsWith('<!', open)) {
      const end = text.indexOf('>', open);
      index = end < 0 ? text.length : end + 1;
      continue;
    }
    // Find the tag end, skipping '>' inside quoted attribute values.
    let end = open + 1;
    let quote = '';
    for (; end < text.length; end++) {
      const char = text[end];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        break;
      }
    }
    const body = text.slice(open + 1, end);
    index = end + 1;
    if (body.startsWith('/')) {
      const name = localName(body.slice(1).trim());
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth].name === name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }
    const selfClosing = body.endsWith('/');
    const content = selfClosing ? body.slice(0, -1) : body;
    const nameMatch = /^[^\s/>]+/.exec(content);
    if (!nameMatch) continue;
    const node: XmlNode = {name: localName(nameMatch[0]), attrs: {}, children: [], text: ''};
    ATTRIBUTE.lastIndex = nameMatch[0].length;
    let attribute: RegExpExecArray | null;
    while ((attribute = ATTRIBUTE.exec(content))) {
      node.attrs[localName(attribute[1])] = decodeXmlEntities(attribute[2] ?? attribute[3] ?? '');
    }
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
};

const child = (node: XmlNode | undefined, name: string): XmlNode | undefined =>
  node?.children.find(item => item.name === name);
const childrenOf = (node: XmlNode | undefined, name: string): XmlNode[] =>
  node ? node.children.filter(item => item.name === name) : [];

const findAll = (node: XmlNode, name: string, found: XmlNode[] = []): XmlNode[] => {
  for (const item of node.children) {
    if (item.name === name) found.push(item);
    findAll(item, name, found);
  }
  return found;
};

/** ISO 8601 duration (PT1H2M3.5S, P1DT2H) in seconds. */
export const parseIsoDuration = (value?: string): number => {
  if (!value) return 0;
  const match = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value.trim());
  if (!match) return 0;
  const [, years, months, days, hours, minutes, seconds] = match.map(part => Number(part || 0));
  return years * 31_536_000 + months * 2_592_000 + days * 86_400 + hours * 3600 + minutes * 60 + seconds;
};

export class DashDrmError extends Error {
  constructor() {
    super('This video is protected (DRM) and cannot be downloaded.');
    this.name = 'DashDrmError';
  }
}

export class DashLiveError extends Error {
  constructor() {
    super('Live DASH streams cannot be downloaded.');
    this.name = 'DashLiveError';
  }
}

export interface DashSegment {
  url: string;
  /** Inclusive byte range "start-end", when only part of the file is the segment. */
  range?: string;
}

export type DashKind = 'video' | 'audio' | 'text';

export interface DashRepresentation {
  id: string;
  kind: DashKind;
  mimeType: string;
  codecs: string;
  bandwidth: number;
  width?: number;
  height?: number;
  lang?: string;
  label: string;
  /** Initialization segment (fMP4 header), when the stream has one. */
  init?: DashSegment;
  segments: DashSegment[];
  /** One whole file at the BaseURL (SegmentBase or BaseURL only). */
  singleFile: boolean;
  /** Video that already carries its own audio. */
  hasAudio: boolean;
}

export interface DashManifest {
  /** Seconds. */
  duration: number;
  representations: DashRepresentation[];
}

const resolve = (base: string, value: string): string => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
};

const baseUrlOf = (node: XmlNode | undefined, parent: string): string => {
  const value = child(node, 'BaseURL')?.text.trim();
  return value ? resolve(parent, value) : parent;
};

/**
 * Fills a SegmentTemplate string. `$$` is a literal dollar; `%0Nd` sets the
 * zero-padded width of a number.
 */
export const expandTemplate = (
  template: string,
  values: {RepresentationID?: string; Number?: number; Time?: number; Bandwidth?: number},
): string =>
  template.replace(/\$(RepresentationID|Number|Time|Bandwidth|)(?:%0(\d+)([diuxX]))?\$/g, (whole, name: string, width?: string, format?: string) => {
    if (!name) return '$';
    const value = values[name as keyof typeof values];
    if (value === undefined) return whole;
    if (typeof value === 'string') return value;
    let textValue = format === 'x' ? value.toString(16) : format === 'X' ? value.toString(16).toUpperCase() : String(Math.trunc(value));
    if (width) textValue = textValue.padStart(Number(width), '0');
    return textValue;
  });

interface TemplateInfo {
  media?: string;
  initialization?: string;
  startNumber: number;
  timescale: number;
  duration?: number;
  presentationTimeOffset: number;
  timeline?: XmlNode;
}

/** SegmentTemplate attributes and timeline, the deepest level winning. */
const mergedTemplate = (levels: (XmlNode | undefined)[]): TemplateInfo | undefined => {
  const templates = levels.map(level => child(level, 'SegmentTemplate')).filter((item): item is XmlNode => Boolean(item));
  if (!templates.length) return undefined;
  const attrs: Record<string, string> = {};
  let timeline: XmlNode | undefined;
  for (const template of templates) {
    Object.assign(attrs, template.attrs);
    timeline = child(template, 'SegmentTimeline') || timeline;
  }
  return {
    media: attrs.media,
    initialization: attrs.initialization,
    startNumber: attrs.startNumber !== undefined ? Number(attrs.startNumber) || 0 : 1,
    timescale: Number(attrs.timescale) || 1,
    duration: attrs.duration !== undefined ? Number(attrs.duration) : undefined,
    presentationTimeOffset: Number(attrs.presentationTimeOffset) || 0,
    timeline,
  };
};

/** Start times of every segment in a SegmentTimeline, in timescale units. */
export const timelineTimes = (timeline: XmlNode, periodEnd?: number): {time: number; duration: number}[] => {
  const entries = childrenOf(timeline, 'S');
  const result: {time: number; duration: number}[] = [];
  let time = 0;
  entries.forEach((entry, position) => {
    if (entry.attrs.t !== undefined) time = Number(entry.attrs.t) || 0;
    const duration = Number(entry.attrs.d) || 0;
    if (duration <= 0) return;
    let repeat = Number(entry.attrs.r || 0);
    if (repeat < 0) {
      // Repeat until the next entry's start or the end of the period.
      const nextStart = entries[position + 1]?.attrs.t;
      const end = nextStart !== undefined ? Number(nextStart) : periodEnd;
      repeat = end !== undefined && end > time ? Math.ceil((end - time) / duration) - 1 : 0;
    }
    for (let index = 0; index <= repeat; index++) {
      result.push({time, duration});
      time += duration;
    }
  });
  return result;
};

const kindOf = (mimeType: string, contentType: string, codecs: string): DashKind | undefined => {
  const type = (contentType || mimeType.split('/')[0] || '').toLowerCase();
  if (type === 'video') return 'video';
  if (type === 'audio') return 'audio';
  if (type === 'text' || /ttml|vtt/i.test(mimeType) || /^(stpp|wvtt)/i.test(codecs)) return 'text';
  if (/^(avc|hvc|hev|vp0?[89]|av01|dvh)/i.test(codecs)) return 'video';
  if (/^(mp4a|ac-3|ec-3|opus|vorbis|flac)/i.test(codecs)) return 'audio';
  return undefined;
};

const describe = (kind: DashKind, bandwidth: number, height?: number, lang?: string, codecs?: string): string => {
  const rate = bandwidth >= 1_000_000 ? `${(bandwidth / 1_000_000).toFixed(1)} Mbps` : `${Math.round(bandwidth / 1000)} kbps`;
  if (kind === 'video') return height ? `${height}p · ${rate}` : `Video · ${rate}`;
  const codec = codecs?.split('.')[0];
  return [lang && lang !== 'und' ? lang : '', codec ? codec.toUpperCase() : '', rate].filter(Boolean).join(' · ') || 'Audio';
};

const rangeOf = (value?: string): string | undefined => (value && /^\d+-\d+$/.test(value.trim()) ? value.trim() : undefined);

const segmentsForRepresentation = (
  levels: (XmlNode | undefined)[],
  representation: XmlNode,
  baseUrl: string,
  periodSeconds: number,
): Pick<DashRepresentation, 'init' | 'segments' | 'singleFile'> => {
  const id = representation.attrs.id || '';
  const bandwidth = Number(representation.attrs.bandwidth) || 0;
  const template = mergedTemplate(levels);
  if (template?.media) {
    const values = {RepresentationID: id, Bandwidth: bandwidth};
    const init = template.initialization ? {url: resolve(baseUrl, expandTemplate(template.initialization, values))} : undefined;
    const segments: DashSegment[] = [];
    if (template.timeline) {
      const periodEnd = periodSeconds > 0 ? template.presentationTimeOffset + periodSeconds * template.timescale : undefined;
      timelineTimes(template.timeline, periodEnd).forEach((entry, index) => {
        segments.push({url: resolve(baseUrl, expandTemplate(template.media!, {...values, Number: template.startNumber + index, Time: entry.time}))});
      });
    } else if (template.duration && template.duration > 0) {
      if (periodSeconds <= 0) throw new Error('This DASH stream has no length, so it cannot be downloaded.');
      const count = Math.ceil((periodSeconds * template.timescale) / template.duration - 1e-9);
      for (let index = 0; index < count; index++) {
        segments.push({
          url: resolve(baseUrl, expandTemplate(template.media, {
            ...values,
            Number: template.startNumber + index,
            Time: template.presentationTimeOffset + index * template.duration,
          })),
        });
      }
    }
    return {init, segments, singleFile: false};
  }

  const list = [...levels].reverse().map(level => child(level, 'SegmentList')).find(Boolean);
  if (list) {
    const initNode = child(list, 'Initialization');
    const init = initNode
      ? {url: initNode.attrs.sourceURL ? resolve(baseUrl, initNode.attrs.sourceURL) : baseUrl, range: rangeOf(initNode.attrs.range)}
      : undefined;
    const segments = childrenOf(list, 'SegmentURL').map(item => ({
      url: item.attrs.media ? resolve(baseUrl, item.attrs.media) : baseUrl,
      range: rangeOf(item.attrs.mediaRange),
    }));
    return {init, segments, singleFile: false};
  }

  // SegmentBase, or nothing but a BaseURL: the whole file is the stream.
  return {segments: [{url: baseUrl}], singleFile: true};
};

const hasProtection = (node: XmlNode): boolean => findAll(node, 'ContentProtection').length > 0;

interface ParsedPeriod {
  duration: number;
  representations: DashRepresentation[];
}

const parsePeriod = (mpd: XmlNode, period: XmlNode, mpdBase: string, periodSeconds: number): ParsedPeriod => {
  const periodBase = baseUrlOf(period, mpdBase);
  const representations: DashRepresentation[] = [];
  for (const set of childrenOf(period, 'AdaptationSet')) {
    const setBase = baseUrlOf(set, periodBase);
    for (const representation of childrenOf(set, 'Representation')) {
      const mimeType = representation.attrs.mimeType || set.attrs.mimeType || '';
      const codecs = representation.attrs.codecs || set.attrs.codecs || '';
      const kind = kindOf(mimeType, set.attrs.contentType || '', codecs);
      if (!kind) continue;
      const bandwidth = Number(representation.attrs.bandwidth) || 0;
      const height = Number(representation.attrs.height || set.attrs.height) || undefined;
      const width = Number(representation.attrs.width || set.attrs.width) || undefined;
      const lang = representation.attrs.lang || set.attrs.lang || undefined;
      const base = baseUrlOf(representation, setBase);
      const levels = [mpd, period, set, representation];
      representations.push({
        id: representation.attrs.id || `${kind}-${representations.length}`,
        kind,
        mimeType,
        codecs,
        bandwidth,
        width,
        height,
        lang,
        label: describe(kind, bandwidth, height, lang, codecs),
        hasAudio: kind === 'video' && /mp4a|ac-3|ec-3|opus/i.test(codecs),
        ...segmentsForRepresentation(levels.slice(1), representation, base, periodSeconds),
      });
    }
  }
  return {duration: periodSeconds, representations};
};

/**
 * Reads a static MPD. Throws DashDrmError for protected streams and
 * DashLiveError for live (dynamic) ones.
 */
export const parseMpd = (text: string, manifestUrl: string): DashManifest => {
  const document = parseXml(text);
  const mpd = child(document, 'MPD');
  if (!mpd) throw new Error('This is not a DASH manifest.');
  if (hasProtection(mpd)) throw new DashDrmError();
  if ((mpd.attrs.type || 'static').toLowerCase() === 'dynamic') throw new DashLiveError();
  const total = parseIsoDuration(mpd.attrs.mediaPresentationDuration);
  const mpdBase = baseUrlOf(mpd, manifestUrl);
  const periods = childrenOf(mpd, 'Period');
  if (!periods.length) throw new Error('This DASH manifest has no content.');

  // Period length: its own duration, else up to the next start, else the rest.
  const starts = periods.map(period => parseIsoDuration(period.attrs.start));
  const parsed = periods.map((period, index) => {
    const own = parseIsoDuration(period.attrs.duration);
    const next = index + 1 < periods.length && periods[index + 1].attrs.start ? starts[index + 1] - starts[index] : 0;
    const seconds = own || next || Math.max(0, total - starts[index]);
    return parsePeriod(mpd, period, mpdBase, seconds);
  });

  // Several periods join up only when each has the same representation ids.
  const [first, ...rest] = parsed;
  const joinable = rest.length > 0 && rest.every(period =>
    first.representations.every(item => period.representations.some(other => other.id === item.id && !other.singleFile && !item.singleFile)),
  );
  const representations = first.representations.map(item => {
    if (!joinable) return item;
    return {
      ...item,
      segments: [item, ...rest.map(period => period.representations.find(other => other.id === item.id)!)].flatMap(entry => entry.segments),
    };
  });
  const duration = total || parsed.reduce((sum, period) => sum + period.duration, 0);
  return {duration: joinable ? duration : first.duration || duration, representations};
};

export interface DashSelection {
  video?: DashRepresentation;
  audio?: DashRepresentation;
}

const videoRank = (item: DashRepresentation) => (item.height || 0) * 1e9 + item.bandwidth;

/** Video choices, best first, one per label. */
export const dashVideoChoices = (manifest: DashManifest): DashRepresentation[] => {
  const seen = new Set<string>();
  return manifest.representations
    .filter(item => item.kind === 'video')
    .sort((left, right) => videoRank(right) - videoRank(left))
    .filter(item => !seen.has(item.label) && Boolean(seen.add(item.label)));
};

/** Audio choices, best first, one per label. */
export const dashAudioChoices = (manifest: DashManifest): DashRepresentation[] => {
  const seen = new Set<string>();
  return manifest.representations
    .filter(item => item.kind === 'audio')
    .sort((left, right) => right.bandwidth - left.bandwidth)
    .filter(item => !seen.has(item.label) && Boolean(seen.add(item.label)));
};

/** The chosen representations, falling back to the best of each kind. */
export const selectDash = (manifest: DashManifest, wanted: {video?: string; audio?: string} = {}): DashSelection => {
  const videos = dashVideoChoices(manifest);
  const audios = dashAudioChoices(manifest);
  const video = videos.find(item => item.id === wanted.video) || videos[0];
  const audio = wanted.audio === 'none' || video?.hasAudio
    ? undefined
    : audios.find(item => item.id === wanted.audio) || audios[0];
  if (!video && !audio) throw new Error('This DASH stream has no video or audio.');
  return {video, audio};
};

/** Rough size from the bit rate and the length, for the progress bar. */
export const estimateDashBytes = (manifest: DashManifest, selection: DashSelection): number =>
  Math.round((((selection.video?.bandwidth || 0) + (selection.audio?.bandwidth || 0)) * manifest.duration) / 8);

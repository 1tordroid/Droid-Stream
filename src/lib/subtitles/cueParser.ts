/**
 * Subtitle files as plain timed lines: SRT, WebVTT, SSA/ASS and simple TTML.
 * Styling is dropped; line breaks are kept. Times are in seconds.
 */

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'ttml';

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};

const decodeEntities = (text: string) =>
  text
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_m, name) => ENTITIES[name]);

/** Markup, ASS override blocks and extra spaces removed. */
export const cleanCueText = (text: string): string =>
  decodeEntities(
    text
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\h/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

/** "01:02:03,456", "02:03.456", "1:02:03.45" (ASS centiseconds). */
export const parseClock = (value: string): number | undefined => {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!match) return undefined;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4] ? Number(match[4]) / 10 ** match[4].length : 0;
  return hours * 3600 + minutes * 60 + seconds + fraction;
};

const sortCues = (cues: SubtitleCue[]) =>
  cues
    .filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.text)
    .sort((a, b) => a.start - b.start || a.end - b.end);

const TIMING_LINE = /^\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)/;

/** SRT and WebVTT share the "start --> end" block layout. */
const parseArrowBlocks = (body: string): SubtitleCue[] => {
  const cues: SubtitleCue[] = [];
  const lines = body.split('\n');
  let index = 0;
  while (index < lines.length) {
    const timing = lines[index].match(TIMING_LINE);
    if (!timing) {
      index++;
      continue;
    }
    const start = parseClock(timing[1]);
    const end = parseClock(timing[2]);
    index++;
    const text: string[] = [];
    while (index < lines.length && lines[index].trim() !== '' && !TIMING_LINE.test(lines[index])) {
      text.push(lines[index]);
      index++;
    }
    // A numeric SRT counter right before the next timing line is not text.
    if (text.length > 1 && /^\d+$/.test(text[text.length - 1].trim()) && TIMING_LINE.test(lines[index] || '')) text.pop();
    if (start !== undefined && end !== undefined) {
      cues.push({start, end, text: cleanCueText(text.join('\n'))});
    }
  }
  return cues;
};

const parseVtt = (body: string): SubtitleCue[] => {
  // NOTE and STYLE blocks have no timing line, so the block reader skips them.
  return parseArrowBlocks(body);
};

const parseAss = (body: string): SubtitleCue[] => {
  const cues: SubtitleCue[] = [];
  let fields: string[] | undefined;
  let inEvents = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inEvents = line.toLowerCase() === '[events]';
      continue;
    }
    if (!inEvents) continue;
    const lower = line.toLowerCase();
    if (lower.startsWith('format:')) {
      fields = line.slice(7).split(',').map(field => field.trim().toLowerCase());
      continue;
    }
    if (!lower.startsWith('dialogue:')) continue;
    const order = fields || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const parts = line.slice(9).split(',');
    const textIndex = order.indexOf('text');
    if (textIndex < 0 || parts.length < order.length) continue;
    const value = (name: string) => parts[order.indexOf(name)]?.trim() || '';
    const start = parseClock(value('start'));
    const end = parseClock(value('end'));
    const text = parts.slice(textIndex).join(',');
    if (start !== undefined && end !== undefined) cues.push({start, end, text: cleanCueText(text)});
  }
  return cues;
};

/** TTML time: clock time, or an offset such as "12.5s", "800ms", "2m" or ticks. */
const parseTtmlTime = (value: string | undefined, tickRate: number): number | undefined => {
  if (!value) return undefined;
  const clock = value.match(/^(\d+):(\d{2}):(\d{2})(?:(?:\.|:)(\d+))?$/);
  if (clock) {
    const fraction = clock[4] ? Number(`0.${clock[4]}`) : 0;
    return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) + fraction;
  }
  const offset = value.match(/^([\d.]+)(h|ms|m|s|t)$/);
  if (!offset) return undefined;
  const amount = Number(offset[1]);
  switch (offset[2]) {
    case 'h':
      return amount * 3600;
    case 'm':
      return amount * 60;
    case 'ms':
      return amount / 1000;
    case 't':
      return amount / tickRate;
    default:
      return amount;
  }
};

const attribute = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

const parseTtml = (body: string): SubtitleCue[] => {
  const tickRate = Number(body.match(/tickRate="(\d+)"/)?.[1]) || 10000000;
  const cues: SubtitleCue[] = [];
  const paragraph = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let match: RegExpExecArray | null;
  while ((match = paragraph.exec(body))) {
    const tag = ` ${match[1]}`;
    const start = parseTtmlTime(attribute(tag, 'begin'), tickRate);
    let end = parseTtmlTime(attribute(tag, 'end'), tickRate);
    const duration = parseTtmlTime(attribute(tag, 'dur'), tickRate);
    if (end === undefined && start !== undefined && duration !== undefined) end = start + duration;
    if (start !== undefined && end !== undefined) cues.push({start, end, text: cleanCueText(match[2])});
  }
  return cues;
};

/** Guesses the format from the text, then the file name or mime type. */
export const detectSubtitleFormat = (text: string, hint = ''): SubtitleFormat => {
  const head = text.slice(0, 2000);
  if (/^﻿?WEBVTT/.test(head)) return 'vtt';
  if (/^\s*\[script info\]/im.test(head) || /^\s*dialogue:/im.test(text.slice(0, 20000))) return 'ass';
  if (/<tt[\s>]/.test(head)) return 'ttml';
  const lowerHint = hint.toLowerCase();
  if (lowerHint.includes('vtt')) return 'vtt';
  if (lowerHint.includes('ssa') || lowerHint.includes('ass')) return 'ass';
  if (lowerHint.includes('ttml') || lowerHint.includes('xml') || lowerHint.includes('dfxp')) return 'ttml';
  return 'srt';
};

export const parseSubtitles = (text: string, hint?: string): SubtitleCue[] => {
  const body = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  switch (detectSubtitleFormat(body, hint)) {
    case 'vtt':
      return sortCues(parseVtt(body));
    case 'ass':
      return sortCues(parseAss(body));
    case 'ttml':
      return sortCues(parseTtml(body));
    default:
      return sortCues(parseArrowBlocks(body));
  }
};

/** Index of the first cue that starts after [time] (or at it, when [inclusive] is false). Cues are sorted by start. */
const firstStartingAfter = (cues: SubtitleCue[], time: number, inclusive = true): number => {
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (inclusive ? cues[mid].start <= time : cues[mid].start < time) low = mid + 1;
    else high = mid;
  }
  return low;
};

/** A line that started this long ago is not looked for (signs can stay up for a while). */
const LONGEST_LINE_SECONDS = 120;

/** The lines showing at [time], joined. Empty when none shows. */
export const cueTextAt = (cues: SubtitleCue[], time: number): string => {
  if (!cues.length) return '';
  const texts: string[] = [];
  for (let index = firstStartingAfter(cues, time) - 1; index >= 0 && time - cues[index].start < LONGEST_LINE_SECONDS; index--) {
    if (cues[index].end > time) texts.push(cues[index].text);
  }
  return texts.reverse().join('\n');
};

/** Up to [before] cues starting before [time] and [after] from it on, for picking a line. */
export const cuesAround = (cues: SubtitleCue[], time: number, before = 6, after = 10): {cue: SubtitleCue; index: number}[] => {
  const low = firstStartingAfter(cues, time, false);
  const from = Math.max(0, low - before);
  const to = Math.min(cues.length, low + after);
  const result: {cue: SubtitleCue; index: number}[] = [];
  for (let index = from; index < to; index++) result.push({cue: cues[index], index});
  return result;
};

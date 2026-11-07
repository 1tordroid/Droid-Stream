import type {YtdlRequest} from './types';

/**
 * Options the app sets itself. A template that sets them would write files
 * where the app cannot find them, run programs, or replace yt-dlp.
 * The value says whether the option takes an argument.
 */
const RESERVED_OPTIONS: Record<string, boolean> = {
  '-o': true,
  '--output': true,
  '-P': true,
  '--paths': true,
  '--ffmpeg-location': true,
  '--cookies': true,
  '--cookies-from-browser': true,
  '-U': false,
  '--update': false,
  '--update-to': true,
  '--exec': true,
  '--exec-before-download': true,
  '-a': true,
  '--batch-file': true,
  '--config-location': true,
  '--config-locations': true,
  '--load-info-json': true,
  '--plugin-dirs': true,
  '--print-to-file': true,
  '--js-runtimes': true,
  '-j': false,
  '--dump-json': false,
  '-J': false,
  '--dump-single-json': false,
  '-s': false,
  '--simulate': false,
  '--skip-download': false,
};

/** Splits a template the way a shell would: quotes group, a backslash escapes. */
export const splitArgs = (text: string): string[] => {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && quote === '"' && index + 1 < text.length) {
        index += 1;
        current += text[index];
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === '\\' && index + 1 < text.length) {
      index += 1;
      current += text[index];
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        args.push(current);
        current = '';
        started = false;
      }
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) throw new Error('A quote is not closed');
  if (started) args.push(current);
  return args;
};

/** Drops options the app controls. Returns the kept arguments and what was dropped. */
export const sanitizeCustomArgs = (args: string[]): {args: string[]; removed: string[]} => {
  const kept: string[] = [];
  const removed: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const name = arg.startsWith('--') ? arg.split('=')[0] : arg;
    if (name in RESERVED_OPTIONS) {
      removed.push(name);
      if (RESERVED_OPTIONS[name] && !arg.includes('=')) index += 1;
      continue;
    }
    // Short options glued to their value, such as -o%(title)s.
    if (/^-[oPa]./.test(arg)) {
      removed.push(arg.slice(0, 2));
      continue;
    }
    // A URL in a template would be downloaded with every item.
    if (/^https?:\/\//i.test(arg) && !/^--?/.test(args[index - 1] || '')) {
      removed.push(arg);
      continue;
    }
    kept.push(arg);
  }
  return {args: kept, removed};
};

const pad = (value: number) => String(value).padStart(2, '0');

/** Seconds as H:MM:SS.ms for --download-sections. */
export const formatTimestamp = (seconds: number): string => {
  const safe = Math.max(0, seconds);
  const whole = Math.floor(safe);
  const fraction = Math.round((safe - whole) * 1000);
  const text = `${Math.floor(whole / 3600)}:${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}`;
  return fraction ? `${text}.${String(fraction).padStart(3, '0')}` : text;
};

/** Reads "90", "1:30" or "1:02:03" as seconds. Empty or invalid text is undefined. */
export const parseTimestamp = (text: string): number | undefined => {
  const value = text.trim();
  if (!value) return undefined;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(value)) return undefined;
  return value
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0);
};

/** The extension of the saved file, when the options fix it in advance. */
export const expectedExtension = (request: YtdlRequest): string | undefined => {
  if (request.kind === 'video') return request.container;
  return request.audioFormat === 'best' ? undefined : request.audioFormat;
};

const videoSelector = (request: YtdlRequest): string => {
  if (request.formatId) {
    const id = request.formatId;
    return `${id}+ba/${id}/bv*+ba/b`;
  }
  if (!request.maxHeight) return 'bv*+ba/b';
  const limit = `[height<=${request.maxHeight}]`;
  // Fall back to the best format when nothing is small enough.
  return `bv*${limit}+ba/b${limit}/bv*+ba/b`;
};

const audioSelector = (request: YtdlRequest): string => {
  if (request.formatId) return `${request.formatId}/ba/b`;
  if (request.audioFormat === 'm4a') return 'ba[ext=m4a]/ba/b';
  if (request.audioFormat === 'opus') return 'ba[acodec^=opus]/ba/b';
  return 'ba/b';
};

/** yt-dlp command-line options for one download (no URL or output path). */
export const buildYtdlArgs = (request: YtdlRequest): string[] => {
  const args: string[] = ['--no-playlist', '--no-mtime'];

  if (request.kind === 'video') {
    args.push('-f', videoSelector(request));
    const sort = [request.maxHeight ? `res:${request.maxHeight}` : 'res'];
    // H.264 and AAC play everywhere and need no conversion into MP4.
    if (request.container === 'mp4') sort.push('ext:mp4:m4a');
    args.push('-S', sort.join(','));
    args.push('--merge-output-format', request.container);
    args.push('--remux-video', request.container);
  } else {
    args.push('-f', audioSelector(request), '-x');
    if (request.audioFormat !== 'best') {
      args.push('--audio-format', request.audioFormat);
    }
    if (request.audioFormat === 'mp3') args.push('--audio-quality', '0');
  }

  const languages = request.subtitleLanguages.filter(Boolean);
  if (request.subtitleMode !== 'off' && languages.length > 0) {
    args.push('--write-subs');
    if (request.autoSubtitles) args.push('--write-auto-subs');
    args.push('--sub-langs', languages.join(','));
    if (request.subtitleMode === 'embed' && request.kind === 'video') {
      args.push('--embed-subs');
    } else {
      args.push('--convert-subs', 'srt');
    }
  }

  const ext = expectedExtension(request);
  // Cover art in Opus or an unknown audio type needs mutagen, which the app
  // does not ship (it is GPL), and a failed embed fails the download.
  const canEmbedThumbnail = request.kind === 'video' || ext === 'm4a' || ext === 'mp3';
  if (request.embedThumbnail && canEmbedThumbnail) {
    args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg');
  }
  if (request.embedMetadata) args.push('--embed-metadata');
  if (request.embedChapters) args.push('--embed-chapters');

  if (request.sponsorBlock !== 'off' && request.sponsorCategories.length > 0) {
    args.push(
      request.sponsorBlock === 'remove' ? '--sponsorblock-remove' : '--sponsorblock-mark',
      request.sponsorCategories.join(','),
    );
  }

  const section = request.section;
  if (section && (section.start !== undefined || section.end !== undefined)) {
    const start = formatTimestamp(section.start ?? 0);
    const end = section.end !== undefined ? formatTimestamp(section.end) : 'inf';
    args.push('--download-sections', `*${start}-${end}`);
    if (request.preciseCut) args.push('--force-keyframes-at-cuts');
  }

  if (request.rateLimit && /^\d+(\.\d+)?[KMG]?$/i.test(request.rateLimit)) {
    args.push('-r', request.rateLimit);
  }

  if (request.extraArgs?.length) {
    args.push(...sanitizeCustomArgs(request.extraArgs).args);
  }
  return args;
};

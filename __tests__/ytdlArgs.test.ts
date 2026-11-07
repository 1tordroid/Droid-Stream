import {describe, expect, it} from '@jest/globals';
import {
  buildYtdlArgs,
  expectedExtension,
  formatTimestamp,
  parseTimestamp,
  sanitizeCustomArgs,
  splitArgs,
} from '../src/lib/ytdl/args';
import type {YtdlRequest} from '../src/lib/ytdl/types';

const base: YtdlRequest = {
  kind: 'video',
  maxHeight: 1080,
  container: 'mp4',
  audioFormat: 'm4a',
  subtitleMode: 'off',
  subtitleLanguages: [],
  autoSubtitles: false,
  embedThumbnail: false,
  embedMetadata: false,
  embedChapters: false,
  sponsorBlock: 'off',
  sponsorCategories: [],
};

const valueAfter = (args: string[], option: string) => args[args.indexOf(option) + 1];

describe('buildYtdlArgs', () => {
  it('limits the height, prefers MP4 streams, and merges into the container', () => {
    const args = buildYtdlArgs(base);
    expect(args.slice(0, 2)).toEqual(['--no-playlist', '--no-mtime']);
    expect(valueAfter(args, '-f')).toBe('bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b');
    expect(valueAfter(args, '-S')).toBe('res:1080,ext:mp4:m4a');
    expect(valueAfter(args, '--merge-output-format')).toBe('mp4');
    expect(valueAfter(args, '--remux-video')).toBe('mp4');
    expect(args).not.toContain('-x');
  });

  it('takes the best video without a height limit, and MKV without the MP4 preference', () => {
    const args = buildYtdlArgs({...base, maxHeight: null, container: 'mkv'});
    expect(valueAfter(args, '-f')).toBe('bv*+ba/b');
    expect(valueAfter(args, '-S')).toBe('res');
    expect(valueAfter(args, '--merge-output-format')).toBe('mkv');
  });

  it('uses an exact format with the best audio added', () => {
    const args = buildYtdlArgs({...base, formatId: '137'});
    expect(valueAfter(args, '-f')).toBe('137+ba/137/bv*+ba/b');
  });

  it('extracts and converts audio', () => {
    const mp3 = buildYtdlArgs({...base, kind: 'audio', audioFormat: 'mp3'});
    expect(valueAfter(mp3, '-f')).toBe('ba/b');
    expect(mp3).toContain('-x');
    expect(valueAfter(mp3, '--audio-format')).toBe('mp3');
    expect(valueAfter(mp3, '--audio-quality')).toBe('0');
    expect(mp3).not.toContain('--merge-output-format');

    const m4a = buildYtdlArgs({...base, kind: 'audio', audioFormat: 'm4a'});
    expect(valueAfter(m4a, '-f')).toBe('ba[ext=m4a]/ba/b');
    expect(m4a).not.toContain('--audio-quality');

    const original = buildYtdlArgs({...base, kind: 'audio', audioFormat: 'best'});
    expect(original).toContain('-x');
    expect(original).not.toContain('--audio-format');
  });

  it('embeds subtitles in a video and writes separate files for audio', () => {
    const embedded = buildYtdlArgs({...base, subtitleMode: 'embed', subtitleLanguages: ['en', 'hi'], autoSubtitles: true});
    expect(embedded).toEqual(expect.arrayContaining(['--write-subs', '--write-auto-subs', '--embed-subs']));
    expect(valueAfter(embedded, '--sub-langs')).toBe('en,hi');

    const audio = buildYtdlArgs({...base, kind: 'audio', subtitleMode: 'embed', subtitleLanguages: ['en']});
    expect(audio).not.toContain('--embed-subs');
    expect(valueAfter(audio, '--convert-subs')).toBe('srt');
  });

  it('writes no subtitles without a language', () => {
    const args = buildYtdlArgs({...base, subtitleMode: 'embed', subtitleLanguages: []});
    expect(args).not.toContain('--write-subs');
  });

  it('embeds the cover only where it works without mutagen', () => {
    expect(buildYtdlArgs({...base, embedThumbnail: true})).toEqual(
      expect.arrayContaining(['--embed-thumbnail', '--convert-thumbnails', 'jpg']),
    );
    expect(buildYtdlArgs({...base, kind: 'audio', audioFormat: 'mp3', embedThumbnail: true})).toContain('--embed-thumbnail');
    expect(buildYtdlArgs({...base, kind: 'audio', audioFormat: 'opus', embedThumbnail: true})).not.toContain('--embed-thumbnail');
    expect(buildYtdlArgs({...base, kind: 'audio', audioFormat: 'best', embedThumbnail: true})).not.toContain('--embed-thumbnail');
  });

  it('adds metadata, chapters, SponsorBlock, a cut and a speed limit', () => {
    const args = buildYtdlArgs({
      ...base,
      embedMetadata: true,
      embedChapters: true,
      sponsorBlock: 'remove',
      sponsorCategories: ['sponsor', 'intro'],
      section: {start: 75, end: 3723.5},
      preciseCut: true,
      rateLimit: '2M',
    });
    expect(args).toEqual(expect.arrayContaining(['--embed-metadata', '--embed-chapters', '--force-keyframes-at-cuts']));
    expect(valueAfter(args, '--sponsorblock-remove')).toBe('sponsor,intro');
    expect(valueAfter(args, '--download-sections')).toBe('*0:01:15-1:02:03.500');
    expect(valueAfter(args, '-r')).toBe('2M');

    const marked = buildYtdlArgs({...base, sponsorBlock: 'mark', sponsorCategories: ['sponsor'], section: {start: 30}, rateLimit: 'fast'});
    expect(valueAfter(marked, '--sponsorblock-mark')).toBe('sponsor');
    expect(valueAfter(marked, '--download-sections')).toBe('*0:00:30-inf');
    expect(marked).not.toContain('-r');
  });

  it('appends template arguments after removing the reserved ones', () => {
    const args = buildYtdlArgs({...base, extraArgs: ['--limit-rate', '1M', '-o', '/sdcard/x', '--exec', 'rm -rf /']});
    expect(args.slice(-2)).toEqual(['--limit-rate', '1M']);
    expect(args).not.toContain('-o');
    expect(args).not.toContain('--exec');
  });
});

describe('expectedExtension', () => {
  it('knows the file type except for original audio', () => {
    expect(expectedExtension(base)).toBe('mp4');
    expect(expectedExtension({...base, kind: 'audio', audioFormat: 'opus'})).toBe('opus');
    expect(expectedExtension({...base, kind: 'audio', audioFormat: 'best'})).toBeUndefined();
  });
});

describe('splitArgs', () => {
  it('splits like a shell', () => {
    expect(splitArgs(`-S "res:480,codec:h264"  --limit-rate 1M --sub-langs 'en,hi'`)).toEqual([
      '-S',
      'res:480,codec:h264',
      '--limit-rate',
      '1M',
      '--sub-langs',
      'en,hi',
    ]);
    expect(splitArgs('--match-filter "title*=\\"live\\"" a\\ b ""')).toEqual(['--match-filter', 'title*="live"', 'a b', '']);
    expect(splitArgs('   ')).toEqual([]);
  });

  it('rejects an open quote', () => {
    expect(() => splitArgs('-f "best')).toThrow('A quote is not closed');
  });
});

describe('sanitizeCustomArgs', () => {
  it('drops options the app controls with their values', () => {
    expect(
      sanitizeCustomArgs([
        'https://example.com/v', '-o', 'x', '--output=y', '-P', 'p', '--ffmpeg-location', 'f', '--cookies', 'c', '-U', '--exec', 'cmd',
        '-otemplate', '--batch-file', 'list', '--embed-subs',
      ]),
    ).toEqual({
      args: ['--embed-subs'],
      removed: ['https://example.com/v', '-o', '--output', '-P', '--ffmpeg-location', '--cookies', '-U', '--exec', '-o', '--batch-file'],
    });
  });

  it('keeps URLs that are option values', () => {
    expect(sanitizeCustomArgs(['--referer', 'https://example.com']).args).toEqual(['--referer', 'https://example.com']);
  });
});

describe('timestamps', () => {
  it('formats and parses', () => {
    expect(formatTimestamp(0)).toBe('0:00:00');
    expect(formatTimestamp(59.25)).toBe('0:00:59.250');
    expect(parseTimestamp('90')).toBe(90);
    expect(parseTimestamp('1:30')).toBe(90);
    expect(parseTimestamp('1:02:03')).toBe(3723);
    expect(parseTimestamp('1:2:3:4')).toBeUndefined();
    expect(parseTimestamp('abc')).toBeUndefined();
    expect(parseTimestamp('')).toBeUndefined();
  });
});

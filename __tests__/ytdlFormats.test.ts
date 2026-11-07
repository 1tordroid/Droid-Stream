import {describe, expect, it} from '@jest/globals';
import {
  bestAudioSize,
  defaultSubtitleSelection,
  describeFormat,
  isPageLink,
  parseYtdlInfo,
  qualityOptions,
  sortedFormats,
  subtitleLanguages,
  urlInSharedText,
} from '../src/lib/ytdl/formats';
import type {YtdlVideoInfo} from '../src/lib/ytdl/types';

// The shape the Python bridge writes, trimmed from a real YouTube answer.
const VIDEO_JSON = JSON.stringify({
  type: 'video',
  id: 'abc',
  title: 'A video',
  uploader: 'Someone',
  duration: 212,
  thumbnail: 'https://i.ytimg.com/vi/abc/hq.jpg',
  webpageUrl: 'https://www.youtube.com/watch?v=abc',
  extractor: 'Youtube',
  isLive: false,
  chapters: 3,
  formats: [
    {id: 'sb0', ext: 'mhtml', protocol: 'mhtml', vcodec: 'none', acodec: 'none', height: 90},
    {id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129, filesize: 3_000_000},
    {id: '251', ext: 'webm', vcodec: 'none', acodec: 'opus', abr: 135, filesize: 3_400_000, language: 'en'},
    {id: '18', ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, width: 640, fps: 30, filesize: 9_000_000},
    {id: '137', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', height: 1080, fps: 30, filesize: 40_000_000},
    {id: '248', ext: 'webm', vcodec: 'vp9', acodec: 'none', height: 1080, fps: 30, filesize: 45_000_000},
    {id: '299', ext: 'mp4', vcodec: 'avc1.64002a', acodec: 'none', height: 1080, fps: 60},
    {id: '337', ext: 'webm', vcodec: 'vp09.02', acodec: 'none', height: 2160, fps: 60, dynamicRange: 'HDR10'},
    {id: 'bad'},
    {ext: 'mp4'},
  ],
  subtitles: {en: 'English', 'pt-BR': null, live_chat: 'chat'},
  automaticCaptions: ['en-orig', 'en', 'de', 'hi'],
});

const video = parseYtdlInfo(VIDEO_JSON, 'https://youtu.be/abc') as YtdlVideoInfo;

describe('parseYtdlInfo', () => {
  it('reads a video and drops formats without an id', () => {
    expect(video.type).toBe('video');
    expect(video.title).toBe('A video');
    expect(video.formats.map(format => format.id)).toEqual(['sb0', '140', '251', '18', '137', '248', '299', '337', 'bad']);
    expect(video.chapters).toBe(3);
  });

  it('reads a playlist and drops entries without a link', () => {
    const playlist = parseYtdlInfo(
      JSON.stringify({
        type: 'playlist',
        title: 'Mix',
        entries: [
          {index: 1, title: 'One', url: 'https://www.youtube.com/watch?v=1', duration: 60},
          {title: 'No link'},
          {url: 'https://www.youtube.com/watch?v=3'},
        ],
      }),
      'https://www.youtube.com/playlist?list=x',
    );
    expect(playlist.type).toBe('playlist');
    if (playlist.type !== 'playlist') return;
    expect(playlist.webpageUrl).toBe('https://www.youtube.com/playlist?list=x');
    expect(playlist.entries).toEqual([
      expect.objectContaining({index: 1, title: 'One', duration: 60}),
      expect.objectContaining({index: 3, title: 'Item 3', url: 'https://www.youtube.com/watch?v=3'}),
    ]);
  });

  it('throws on text that is not JSON', () => {
    expect(() => parseYtdlInfo('nope', 'https://x')).toThrow();
  });
});

describe('qualityOptions', () => {
  it('lists each height once, best first, with frame rate, HDR and the largest size', () => {
    expect(qualityOptions(video)).toEqual([
      {height: null, label: 'Best'},
      {height: 2160, label: '2160p60 (4K) HDR', fps: 60, hdr: true},
      {height: 1080, label: '1080p60', fps: 60, size: 45_000_000},
      {height: 360, label: '360p', fps: 30, size: 9_000_000},
    ]);
  });

  it('adds the best audio size to video-only sizes', () => {
    expect(bestAudioSize(video)).toBe(3_400_000);
  });
});

describe('subtitleLanguages', () => {
  it('puts uploaded subtitles first and skips automatic captions of the same language', () => {
    const languages = subtitleLanguages(video);
    expect(languages).toEqual([
      {code: 'en', name: 'English', auto: false},
      {code: 'pt-BR', name: 'pt-BR', auto: false},
      {code: 'de', name: 'de (auto)', auto: true},
      {code: 'hi', name: 'hi (auto)', auto: true},
    ]);
  });

  it('picks the preferred languages the video has', () => {
    const languages = subtitleLanguages(video);
    expect(defaultSubtitleSelection(languages, ['en', 'pt', 'hi', 'fr', 'en'])).toEqual(['en', 'pt-BR', 'hi']);
  });
});

describe('format list', () => {
  it('sorts video first by height and leaves out storyboards', () => {
    const ids = sortedFormats(video).map(format => format.id);
    expect(ids[0]).toBe('337');
    expect(ids).not.toContain('sb0');
    expect(ids.indexOf('18')).toBeLessThan(ids.indexOf('251'));
  });

  it('describes formats for the advanced list', () => {
    expect(describeFormat(video.formats.find(format => format.id === '137')!)).toBe('1080p · 30fps · avc1 · no audio · mp4');
    expect(describeFormat(video.formats.find(format => format.id === '251')!)).toBe('audio · opus · 135k · en · webm');
  });
});

describe('links', () => {
  it('finds the link in shared text', () => {
    expect(urlInSharedText('Watch this: https://youtu.be/abc?si=x.')).toBe('https://youtu.be/abc?si=x');
    expect(urlInSharedText('(https://x.com/a/status/1)')).toBe('https://x.com/a/status/1');
    expect(urlInSharedText('nothing here')).toBeUndefined();
  });

  it('tells pages from files', () => {
    expect(isPageLink('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isPageLink('https://www.instagram.com/reel/xyz/')).toBe(true);
    expect(isPageLink('https://cdn.example.com/movie.mkv?token=1')).toBe(false);
    expect(isPageLink('https://example.com/stream/master.m3u8')).toBe(false);
    expect(isPageLink('magnet:?xt=urn:btih:abc')).toBe(false);
  });
});

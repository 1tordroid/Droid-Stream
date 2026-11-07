import {describe, expect, it} from '@jest/globals';
import {classifyMedia, fileNameOf, isSegmentUrl, isYtdlSite, mergeMedia, normalizeMediaUrl, qualityOf, sortMedia, type MediaItem} from '../src/lib/browser/media';
import {displayUrl, hostOf, isWebUrl, looksLikeUrl, originOf, resolveInput, searchQueryOf, searchUrl} from '../src/lib/browser/url';

describe('media detection', () => {
  it('classifies by extension and type', () => {
    expect(classifyMedia('https://a.com/v/movie.mp4?token=1')).toBe('video');
    expect(classifyMedia('https://a.com/live/index.m3u8')).toBe('hls');
    expect(classifyMedia('https://a.com/manifest.mpd')).toBe('dash');
    expect(classifyMedia('https://a.com/song.mp3')).toBe('audio');
    expect(classifyMedia('https://a.com/pic.JPG')).toBe('image');
    expect(classifyMedia('https://a.com/file.torrent')).toBe('torrent');
    expect(classifyMedia('magnet:?xt=urn:btih:abc')).toBe('magnet');
    expect(classifyMedia('https://a.com/get?id=1', 'video/mp4')).toBe('video');
    expect(classifyMedia('https://a.com/get?id=1', 'application/vnd.apple.mpegurl')).toBe('hls');
    expect(classifyMedia('https://a.com/app.apk')).toBe('file');
    expect(classifyMedia('https://a.com/page.html')).toBeNull();
    expect(classifyMedia('blob:https://a.com/123')).toBeNull();
  });

  it('ignores stream pieces', () => {
    expect(isSegmentUrl('https://a.com/hls/seg-12.ts')).toBe(true);
    expect(isSegmentUrl('https://a.com/dash/chunk_5.m4s')).toBe(true);
    expect(isSegmentUrl('https://r1.googlevideo.com/videoplayback?itag=22')).toBe(true);
    expect(classifyMedia('https://a.com/hls/segment12.ts')).toBeNull();
    expect(isSegmentUrl('https://a.com/movie.mp4')).toBe(false);
  });

  it('asks for the whole file instead of a byte range', () => {
    expect(normalizeMediaUrl('https://cdn.fbcdn.net/v.mp4?efg=1&bytestart=0&byteend=999')).toBe('https://cdn.fbcdn.net/v.mp4?efg=1');
    expect(normalizeMediaUrl('https://a.com/v.mp4?x=1')).toBe('https://a.com/v.mp4?x=1');
  });

  it('reads quality and file names', () => {
    expect(qualityOf('https://a.com/video_720p.mp4')).toBe('720p');
    expect(qualityOf('https://a.com/1080/index.m3u8')).toBe('1080p');
    expect(qualityOf('https://a.com/v.mp4', 480)).toBe('480p');
    expect(qualityOf('https://a.com/v.mp4')).toBeUndefined();
    expect(fileNameOf('https://a.com/path/My%20Video.mp4?x=1')).toBe('my video.mp4');
    expect(fileNameOf('https://a.com/')).toBe('download');
  });

  it('merges the same file found twice and sorts videos first', () => {
    const base = {pageUrl: 'https://a.com/', source: 'page' as const, foundAt: 1};
    let list: MediaItem[] = [];
    list = mergeMedia(list, {...base, url: 'https://a.com/pic.jpg', kind: 'image', width: 800, height: 600});
    list = mergeMedia(list, {...base, url: 'https://a.com/v.mp4?bytestart=0&byteend=10', kind: 'video'});
    list = mergeMedia(list, {...base, url: 'https://a.com/v.mp4', kind: 'video', source: 'network', poster: 'p.jpg'});
    expect(list).toHaveLength(2);
    expect(list.find(item => item.kind === 'video')?.poster).toBe('p.jpg');
    expect(sortMedia(list)[0].kind).toBe('video');
  });

  it('knows sites yt-dlp reads', () => {
    expect(isYtdlSite('https://m.youtube.com/watch?v=1')).toBe(true);
    expect(isYtdlSite('https://www.instagram.com/reel/x/')).toBe(true);
    expect(isYtdlSite('https://notyoutube.com/')).toBe(false);
  });
});

describe('address bar', () => {
  it('opens addresses and searches everything else', () => {
    expect(resolveInput('example.com')).toBe('https://example.com');
    expect(resolveInput('https://example.com/a b')).toBe('https://example.com/a b');
    expect(resolveInput('news.bbc.co.uk/sport')).toBe('https://news.bbc.co.uk/sport');
    expect(resolveInput('192.168.1.5:8080')).toBe('http://192.168.1.5:8080');
    expect(resolveInput('localhost:3000')).toBe('http://localhost:3000');
    expect(resolveInput('best movies 2026')).toBe('https://duckduckgo.com/?q=best%20movies%202026');
    expect(resolveInput('cats', 'google')).toBe('https://www.google.com/search?q=cats');
    expect(resolveInput('hello')).toBe('https://duckduckgo.com/?q=hello');
    expect(resolveInput('')).toBe('about:blank');
    expect(looksLikeUrl('file.txt is big')).toBe(false);
    expect(looksLikeUrl('magnet:?xt=urn:btih:1')).toBe(true);
  });

  it('builds searches for every engine and reads them back', () => {
    expect(searchUrl('a&b', 'bing')).toBe('https://www.bing.com/search?q=a%26b');
    expect(searchUrl('x', 'brave')).toBe('https://search.brave.com/search?q=x');
    expect(searchUrl('x', 'startpage')).toBe('https://www.startpage.com/do/search?q=x');
    expect(searchQueryOf('https://duckduckgo.com/?q=best%20movies&t=h')).toBe('best movies');
    expect(searchQueryOf('https://example.com/')).toBeUndefined();
  });

  it('reads hosts and origins, and shows short addresses', () => {
    expect(hostOf('https://user:pw@WWW.Example.com:8080/x')).toBe('www.example.com');
    expect(originOf('https://www.example.com:8080/x?y')).toBe('https://www.example.com:8080');
    expect(displayUrl('https://www.example.com/')).toBe('example.com');
    expect(isWebUrl('intent://x#Intent;end')).toBe(false);
    expect(isWebUrl('https://a.com')).toBe(true);
  });
});

describe('downloadTitle', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {downloadTitle} = require('../src/lib/browser/url');
  test('keeps a real title', () => {
    expect(downloadTitle('Big Buck Bunny', 'https://www.w3schools.com/html/html5_video.asp', 'mov_bbb')).toBe('Big Buck Bunny');
  });
  test('turns an address into the site name', () => {
    expect(downloadTitle('w3schools.com/html/html5_video.asp', 'https://www.w3schools.com/html/html5_video.asp', 'mov_bbb')).toBe('w3schools.com');
    expect(downloadTitle(undefined, 'https://www.w3schools.com/x', 'mov_bbb')).toBe('w3schools.com');
  });
});

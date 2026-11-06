import {describe, expect, it} from '@jest/globals';
import {
  MIN_SPLIT_BYTES,
  compareQueue,
  etaSeconds,
  fileCategory,
  findDuplicate,
  mergeRanges,
  missingRanges,
  moveQueueItem,
  parseBlocklist,
  parseDashRepresentations,
  parseHlsVariants,
  planSegments,
  resumePlan,
  retryDelayMs,
  splitLargestOwned,
  transferAllowed,
} from '../src/lib/downloadEngine/planner';

describe('segment splitting', () => {
  it('gives each connection a piece by halving the largest one', () => {
    const total = MIN_SPLIT_BYTES * 8;
    const segments = planSegments(total, 4, true);
    expect(segments).toHaveLength(4);
    expect(segments[0].start).toBe(0);
    expect(segments[segments.length - 1].end).toBe(total);
    const covered = segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
    expect(covered).toBe(total);
  });

  it('does not split a piece that would leave a tiny half', () => {
    const segments = [{start: 0, end: MIN_SPLIT_BYTES * 2 - 1, owned: true}];
    expect(splitLargestOwned(segments)).toBeNull();
  });

  it('falls back to one connection when the server has no ranges', () => {
    expect(planSegments(MIN_SPLIT_BYTES * 20, 8, false)).toEqual([
      {start: 0, end: MIN_SPLIT_BYTES * 20, owned: true},
    ]);
  });
});

describe('resume and merging', () => {
  it('merges adjacent saved ranges and reports the hole that remains', () => {
    expect(mergeRanges([{start: 0, end: 100}, {start: 100, end: 250}, {start: 400, end: 500}])).toEqual([
      {start: 0, end: 250},
      {start: 400, end: 500},
    ]);
    expect(missingRanges(500, [{start: 0, end: 250}, {start: 400, end: 500}])).toEqual([
      {start: 250, end: 400},
    ]);
  });

  it('resumes from the bytes that are still missing', () => {
    const plan = resumePlan(1000, [{start: 0, end: 100}, {start: 100, end: 200}, {start: 800, end: 1000}]);
    expect(plan.holes).toEqual([{start: 0, end: 200}, {start: 800, end: 1000}]);
    expect(plan.downloadedBytes).toBe(600);
    expect(plan.remainingBytes).toBe(400);
  });
});

describe('download helpers', () => {
  it('backs off and estimates the remaining time', () => {
    expect(retryDelayMs(0)).toBe(1000);
    expect(retryDelayMs(5)).toBe(30000);
    expect(etaSeconds(1000, 100)).toBe(10);
    expect(etaSeconds(1000, 0)).toBeNull();
  });

  it('sorts files into folders and notices duplicates', () => {
    expect(fileCategory('movie.mkv')).toBe('Video');
    expect(fileCategory('song.flac')).toBe('Audio');
    expect(fileCategory('captions.srt')).toBe('Subtitles');
    expect(fileCategory('notes.txt')).toBe('Other');
    const existing = [{url: 'https://example.com/a.mp4', fileName: 'a.mp4', size: 10}];
    expect(findDuplicate(existing, {url: 'https://example.com/a.mp4'})).toBe(existing[0]);
    expect(findDuplicate(existing, {url: 'https://example.com/b.mp4', fileName: 'a.mp4', size: 10})).toBe(existing[0]);
  });

  it('reorders a queue and respects schedule, wifi, and charging', () => {
    expect(moveQueueItem(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    const now = new Date(2026, 0, 5, 2, 0, 0); // Monday 02:00
    expect(transferAllowed({
      wifiOnly: true, onWifi: false, chargingOnly: false, charging: true,
      pauseOnBatterySaver: false, powerSave: false, requireVpn: false, vpnConnected: false,
      scheduleEnabled: false, windows: [], now,
    }).reason).toMatch(/Wi-Fi/);
    expect(transferAllowed({
      wifiOnly: false, onWifi: true, chargingOnly: false, charging: false,
      pauseOnBatterySaver: false, powerSave: false, requireVpn: false, vpnConnected: false,
      scheduleEnabled: true, windows: [{days: [1], startMinutes: 60, endMinutes: 180}], now,
    }).allowed).toBe(true);
    const ordered = [
      {id: 'old', createdAt: 1},
      {id: 'new', createdAt: 2},
    ].sort((left, right) => compareQueue(left, right, {
      new: {queue: 'Downloads', priority: 2, order: 0},
      old: {queue: 'Downloads', priority: 0, order: 0},
    }));
    expect(ordered.map(item => item.id)).toEqual(['new', 'old']);
  });

  it('reads HLS and DASH variants and blocklist lines', () => {
    const hls = parseHlsVariants([
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=1280x720',
      '720.m3u8',
      '#EXT-X-MEDIA:TYPE=AUDIO,NAME="English",URI="audio.m3u8"',
    ].join('\n'), 'https://cdn.example/master.m3u8');
    expect(hls.map(item => item.label)).toEqual(['720p', 'English']);
    expect(hls[0].url).toBe('https://cdn.example/720.m3u8');
    const dash = parseDashRepresentations(
      '<MPD><Representation bandwidth="2000" height="1080" mimeType="video/mp4"><BaseURL>video.mp4</BaseURL></Representation></MPD>',
      'https://cdn.example/manifest.mpd',
    );
    expect(dash[0]).toMatchObject({label: '1080p', url: 'https://cdn.example/video.mp4'});
    expect(parseBlocklist('# note\n1.2.3.0/30\nBad:9.9.9.1-9.9.9.2\n')).toEqual([
      {start: '1.2.3.0', end: '1.2.3.3'},
      {start: '9.9.9.1', end: '9.9.9.2'},
    ]);
  });
});

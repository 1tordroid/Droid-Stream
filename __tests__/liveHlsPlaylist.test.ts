import {
  LiveDrmError,
  buildLocalPlaylist,
  livePollDelayMs,
  newLiveCursor,
  nextLiveSegments,
  parseMediaPlaylist,
  pickLiveVariant,
  recordingStopReason,
  sequenceIv,
} from '../src/lib/downloadEngine/livePlaylist';

const BASE = 'https://live.example.com/ch1/index.m3u8';

const playlist = (first: number, count: number, extra = '', discontinuitySequence = 0) =>
  [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:6',
    `#EXT-X-MEDIA-SEQUENCE:${first}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitySequence}`,
    extra,
    ...Array.from({length: count}, (_, index) => [`#EXTINF:6.000,`, `seg${first + index}.ts`]).flat(),
  ].join('\n');

describe('media playlist', () => {
  it('numbers segments from the media sequence and resolves addresses', () => {
    const parsed = parseMediaPlaylist(playlist(100, 3), BASE);
    expect(parsed.targetDuration).toBe(6);
    expect(parsed.endList).toBe(false);
    expect(parsed.segments.map(item => [item.sequence, item.url])).toEqual([
      [100, 'https://live.example.com/ch1/seg100.ts'],
      [101, 'https://live.example.com/ch1/seg101.ts'],
      [102, 'https://live.example.com/ch1/seg102.ts'],
    ]);
  });

  it('keeps AES-128 keys with explicit or sequence IVs', () => {
    const text = [
      '#EXTM3U', '#EXT-X-TARGETDURATION:4', '#EXT-X-MEDIA-SEQUENCE:7',
      '#EXT-X-KEY:METHOD=AES-128,URI="key1.bin"',
      '#EXTINF:4,', 'a.ts',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.com/k2",IV=0x1F',
      '#EXTINF:4,', 'b.ts',
      '#EXT-X-KEY:METHOD=NONE',
      '#EXTINF:4,', 'c.ts',
    ].join('\n');
    const segments = parseMediaPlaylist(text, BASE).segments;
    expect(segments[0].key).toEqual({method: 'AES-128', uri: 'https://live.example.com/ch1/key1.bin', iv: sequenceIv(7)});
    expect(sequenceIv(7)).toBe('00000000000000000000000000000007');
    expect(segments[1].key).toEqual({method: 'AES-128', uri: 'https://keys.example.com/k2', iv: '0000000000000000000000000000001f'});
    expect(segments[2].key).toBeUndefined();
  });

  it('refuses SAMPLE-AES and DRM key formats', () => {
    const base = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n';
    expect(() => parseMediaPlaylist(`${base}#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"\n#EXTINF:4,\na.ts`, BASE)).toThrow(LiveDrmError);
    expect(() => parseMediaPlaylist(`${base}#EXT-X-KEY:METHOD=AES-128,URI="x",KEYFORMAT="com.widevine"\n#EXTINF:4,\na.ts`, BASE)).toThrow(LiveDrmError);
    expect(() => pickLiveVariant('#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://a"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8', BASE)).toThrow(LiveDrmError);
  });

  it('reads byte ranges and fMP4 maps', () => {
    const text = [
      '#EXTM3U', '#EXT-X-TARGETDURATION:2', '#EXT-X-MAP:URI="init.mp4",BYTERANGE="500@0"',
      '#EXTINF:2,', '#EXT-X-BYTERANGE:1000@500', 'all.mp4',
      '#EXTINF:2,', '#EXT-X-BYTERANGE:700', 'all.mp4',
    ].join('\n');
    const segments = parseMediaPlaylist(text, BASE).segments;
    expect(segments[0].map).toEqual({url: 'https://live.example.com/ch1/init.mp4', range: '0-499'});
    expect(segments.map(item => item.range)).toEqual(['500-1499', '1500-2199']);
  });
});

describe('master playlist', () => {
  it('picks the highest bandwidth with its default audio rendition', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",DEFAULT=YES,URI="audio/en.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="aud"', 'low.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000,AUDIO="aud"', 'high.m3u8',
    ].join('\n');
    expect(pickLiveVariant(text, BASE)).toEqual({
      video: 'https://live.example.com/ch1/high.m3u8',
      audio: 'https://live.example.com/ch1/audio/en.m3u8',
    });
  });
});

describe('live sequencing', () => {
  it('starts at the live edge, then takes only new segments once each', () => {
    let step = nextLiveSegments(newLiveCursor(), parseMediaPlaylist(playlist(100, 6), BASE));
    expect(step.segments.map(item => item.sequence)).toEqual([103, 104, 105]);
    // Same window again: nothing new.
    step = nextLiveSegments(step.cursor, parseMediaPlaylist(playlist(100, 6), BASE));
    expect(step.segments).toEqual([]);
    // The window slid by two.
    step = nextLiveSegments(step.cursor, parseMediaPlaylist(playlist(102, 6), BASE));
    expect(step.segments.map(item => item.sequence)).toEqual([106, 107]);
    expect(step.gap).toBe(false);
    expect(step.segments[0].discontinuity).toBe(false);
  });

  it('marks a gap when segments left the window before they were fetched', () => {
    const first = nextLiveSegments(newLiveCursor(), parseMediaPlaylist(playlist(100, 3), BASE));
    expect(first.cursor.lastSequence).toBe(102);
    const step = nextLiveSegments(first.cursor, parseMediaPlaylist(playlist(110, 3), BASE));
    expect(step.gap).toBe(true);
    expect(step.segments.map(item => [item.sequence, item.discontinuity])).toEqual([[110, true], [111, false], [112, false]]);
  });

  it('ignores a stale, older copy of the playlist', () => {
    const first = nextLiveSegments(newLiveCursor(), parseMediaPlaylist(playlist(100, 6), BASE));
    const step = nextLiveSegments(first.cursor, parseMediaPlaylist(playlist(99, 6), BASE));
    expect(step.segments).toEqual([]);
    expect(step.restarted).toBe(false);
    expect(step.cursor.lastSequence).toBe(105);
  });

  it('starts again with a discontinuity when the stream restarts its numbering', () => {
    const first = nextLiveSegments(newLiveCursor(), parseMediaPlaylist(playlist(5000, 6), BASE));
    const step = nextLiveSegments(first.cursor, parseMediaPlaylist(playlist(0, 4, '', 1), BASE));
    expect(step.restarted).toBe(true);
    expect(step.segments.map(item => [item.sequence, item.discontinuity])).toEqual([[1, true], [2, false], [3, false]]);
    expect(step.cursor.lastSequence).toBe(3);
    // Afterwards it carries on normally from the new numbering.
    const next = nextLiveSegments(step.cursor, parseMediaPlaylist(playlist(1, 4, '', 1), BASE));
    expect(next.segments.map(item => item.sequence)).toEqual([4]);
  });

  it('takes an ended playlist whole', () => {
    const step = nextLiveSegments(newLiveCursor(), parseMediaPlaylist(`${playlist(0, 5)}\n#EXT-X-ENDLIST`, BASE));
    expect(step.segments).toHaveLength(5);
  });

  it('waits a target duration after a change and half of it otherwise', () => {
    const parsed = parseMediaPlaylist(playlist(0, 3), BASE);
    expect(livePollDelayMs(parsed, true)).toBe(6000);
    expect(livePollDelayMs(parsed, false)).toBe(3000);
    expect(livePollDelayMs(undefined, false)).toBe(3000);
  });
});

describe('stopping and the local playlist', () => {
  it('stops at the end time or after the longest duration', () => {
    expect(recordingStopReason({stopAt: 1000}, 999, 0)).toBeUndefined();
    expect(recordingStopReason({stopAt: 1000}, 1000, 0)).toBe('end-time');
    expect(recordingStopReason({maxDurationMs: 60_000}, 0, 59)).toBeUndefined();
    expect(recordingStopReason({maxDurationMs: 60_000}, 0, 60)).toBe('duration');
  });

  it('writes keys, maps and discontinuities the finalizer can read', () => {
    const text = buildLocalPlaylist([
      {file: 's0.ts', duration: 6, discontinuity: false, keyFile: 'key0.key', iv: sequenceIv(1)},
      {file: 's1.ts', duration: 6, discontinuity: false, keyFile: 'key0.key', iv: sequenceIv(1)},
      {file: 's2.ts', duration: 5.5, discontinuity: true, mapFile: 'init0.mp4'},
    ]);
    expect(text.split('\n')).toEqual([
      '#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-TARGETDURATION:6', '#EXT-X-MEDIA-SEQUENCE:0',
      `#EXT-X-KEY:METHOD=AES-128,URI="key0.key",IV=0x${sequenceIv(1)}`,
      '#EXTINF:6.000,', 's0.ts',
      '#EXTINF:6.000,', 's1.ts',
      '#EXT-X-DISCONTINUITY', '#EXT-X-KEY:METHOD=NONE', '#EXT-X-MAP:URI="init0.mp4"',
      '#EXTINF:5.500,', 's2.ts',
      '#EXT-X-ENDLIST', '',
    ]);
  });
});

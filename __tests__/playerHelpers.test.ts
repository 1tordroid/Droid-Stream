import {
  formatTVTimelineTime,
  getPlaybackRenderKey,
  getQualityIconName,
  getResumePosition,
  isCastableStreamUrl,
  withAlpha,
} from '../src/screens/home/player/playerHelpers';

it('formats TV timeline times', () => {
  expect(formatTVTimelineTime(65)).toBe('01:05');
  expect(formatTVTimelineTime(3725)).toBe('1:02:05');
  expect(formatTVTimelineTime(-1)).toBe('00:00');
});

it('resumes only meaningful positions', () => {
  expect(getResumePosition(3, 100)).toBe(0);
  expect(getResumePosition(40, 100)).toBe(40);
});

it('maps video height and labels to quality icons', () => {
  expect(getQualityIconName(2160)).toBe('4k');
  expect(getQualityIconName(undefined, '1080p')).toBe('hd');
  expect(getQualityIconName(undefined, '')).toBe('video-settings');
});

it('only casts URLs a receiver can reach', () => {
  expect(isCastableStreamUrl('http://127.0.0.1:8080/stream/abc/0/x.mkv')).toBe(true);
  expect(isCastableStreamUrl('magnet:?xt=1', 'torrent')).toBe(false);
  expect(isCastableStreamUrl('http://localhost/x.mp4')).toBe(false);
  expect(isCastableStreamUrl('https://cdn.test/x.mp4')).toBe(true);
  expect(isCastableStreamUrl('/storage/emulated/0/x.mkv')).toBe(true);
});

it('keys renders by skip interval and the near-end state', () => {
  const skips = [{from: 10, to: 20}];
  expect(getPlaybackRenderKey(15, skips, 100)).toBe('0:false');
  expect(getPlaybackRenderKey(90, skips, 100)).toBe('-1:true');
  expect(withAlpha('#fff', 0.5)).toBe('#80ffffff');
});

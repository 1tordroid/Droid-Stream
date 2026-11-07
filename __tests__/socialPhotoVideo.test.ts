import {describe, expect, it} from '@jest/globals';
import {
  buildPhotoSongArgs,
  canvasSize,
  CROSSFADE_SECONDS,
  MAX_CLIPS,
  slideshowClips,
  songSegment,
  videoBitrateKbps,
} from '../src/lib/social/photoVideo';

const after = (args: string[], option: string, from = 0) => args[args.indexOf(option, from) + 1];
const inputs = (args: string[]) => args.filter((value, index) => args[index - 1] === '-i');

describe('canvasSize', () => {
  it('keeps the photo shape with even sides, at most 1080 by 1920', () => {
    expect(canvasSize(1080, 1350)).toEqual({width: 1080, height: 1350});
    expect(canvasSize(1440, 1800)).toEqual({width: 1080, height: 1350});
    expect(canvasSize(4000, 3000)).toEqual({width: 1440, height: 1080});
    expect(canvasSize(1081, 1081)).toEqual({width: 1080, height: 1080});
    expect(canvasSize(641, 801)).toEqual({width: 642, height: 802});
    expect(canvasSize()).toEqual({width: 1080, height: 1350});
  });

  it('picks a sensible bitrate', () => {
    expect(videoBitrateKbps(1080, 1350)).toBe(3062);
    expect(videoBitrateKbps(320, 320)).toBe(2000);
    expect(videoBitrateKbps(1920, 1920)).toBe(6000);
  });
});

describe('songSegment', () => {
  it('uses the clip the post picked, or the rest of the song', () => {
    expect(songSegment(182, 45, 15)).toEqual({start: 45, duration: 15});
    expect(songSegment(182, 45, undefined)).toEqual({start: 45, duration: 137});
    expect(songSegment(50, 45, 15)).toEqual({start: 45, duration: 5});
    expect(songSegment(undefined, 10, 20)).toEqual({start: 10, duration: 20});
    expect(songSegment(30, 40, 15)).toEqual({start: 0, duration: 15});
    expect(songSegment(undefined, undefined, undefined)).toEqual({start: 0, duration: 30});
    expect(songSegment(3600, 0, undefined).duration).toBe(600);
  });
});

describe('single photo with song', () => {
  const args = buildPhotoSongArgs({images: ['/w/photo1.jpg'], audio: '/w/song.m4a', output: '/w/out.mp4.part', duration: 15, start: 45, width: 1440, height: 1800});

  it('loops the photo over the song segment', () => {
    expect(inputs(args)).toEqual(['/w/photo1.jpg', '/w/song.m4a']);
    expect(args.slice(args.indexOf('-loop'), args.indexOf('-loop') + 6)).toEqual(['-loop', '1', '-framerate', '1', '-t', '16']);
    // The seek belongs to the song input.
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('/w/song.m4a'));
    expect(after(args, '-ss')).toBe('45');
    expect(after(args, '-map', args.indexOf('-map') + 1)).toBe('1:a:0');
    expect(after(args, '-t', args.indexOf('-filter_complex'))).toBe('15');
  });

  it('makes H.264 and AAC in MP4 at an even size', () => {
    const filter = after(args, '-filter_complex');
    expect(filter).toContain('scale=1080:1350:force_original_aspect_ratio=decrease:force_divisible_by=2');
    expect(filter).toContain('pad=1080:1350:(ow-iw)/2:(oh-ih)/2');
    expect(filter).toContain('fps=30');
    expect(filter).toMatch(/\[c0\]format=nv12\[v\]$/);
    expect(after(args, '-c:v')).toBe('h264_mediacodec');
    expect(after(args, '-b:v')).toBe('3062k');
    expect(after(args, '-c:a')).toBe('aac');
    expect(after(args, '-f')).toBe('mp4');
    expect(args).toContain('+faststart');
    expect(args[args.length - 1]).toBe('/w/out.mp4.part');
  });

  it('can use MPEG-4 when the hardware encoder fails', () => {
    const fallback = buildPhotoSongArgs({images: ['/a.jpg'], audio: '/s.m4a', output: '/o.mp4', duration: 10, encoder: 'mpeg4'});
    expect(after(fallback, '-c:v')).toBe('mpeg4');
    expect(after(fallback, '-filter_complex')).toMatch(/format=yuv420p\[v\]$/);
    expect(fallback).not.toContain('-ss');
  });
});

describe('carousel slideshow', () => {
  it('repeats the photos to cover the song', () => {
    const clips = slideshowClips(['a', 'b', 'c'], 20, 3, false);
    expect(clips.map(clip => clip.image).join('')).toBe('abcabca');
    expect(clips.map(clip => clip.length)).toEqual([3, 3, 3, 3, 3, 3, 2]);
    expect(clips.reduce((sum, clip) => sum + clip.length, 0)).toBe(20);
  });

  it('adds the fade time to every clip but the last, and keeps the last long enough to fade into', () => {
    const clips = slideshowClips(['a', 'b'], 9.3, 3, true);
    // 9.3 s would leave a 0.3 s last clip, shorter than the fade, so it joins the one before.
    expect(clips.map(clip => clip.length)).toEqual([3 + CROSSFADE_SECONDS, 3 + CROSSFADE_SECONDS, 3.3]);
    expect(slideshowClips(['a'], 12, 3, true)).toEqual([{image: 'a', length: 12}]);
  });

  it('stops at the clip limit and holds the last photo', () => {
    const clips = slideshowClips(['a', 'b'], 600, 3, false);
    expect(clips).toHaveLength(MAX_CLIPS);
    expect(clips[MAX_CLIPS - 1].length).toBe(600 - (MAX_CLIPS - 1) * 3);
  });

  it('joins photos with concat, or crossfades at each photo change', () => {
    const plain = buildPhotoSongArgs({images: ['/1.jpg', '/2.jpg'], audio: '/s.m4a', output: '/o.mp4', duration: 7, secondsPerImage: 3, crossfade: false});
    expect(inputs(plain)).toEqual(['/1.jpg', '/2.jpg', '/1.jpg', '/s.m4a']);
    expect(after(plain, '-filter_complex')).toContain('[c0][c1][c2]concat=n=3:v=1:a=0[joined];[joined]format=nv12[v]');
    expect(after(plain, '-map', plain.indexOf('-map') + 1)).toBe('3:a:0');

    const faded = buildPhotoSongArgs({images: ['/1.jpg', '/2.jpg', '/3.jpg'], audio: '/s.m4a', output: '/o.mp4', duration: 9, secondsPerImage: 3, crossfade: true});
    const filter = after(faded, '-filter_complex');
    expect(filter).toContain('[c0][c1]xfade=transition=fade:duration=0.5:offset=3[x1]');
    expect(filter).toContain('[x1][c2]xfade=transition=fade:duration=0.5:offset=6[x2]');
    expect(filter).toContain('[x2]format=nv12[v]');
    expect(filter).toContain('trim=duration=3.5');
    // Each clip input is read a little longer than it shows.
    expect(faded.filter((value, index) => faded[index - 1] === '-t').slice(0, 3)).toEqual(['5', '5', '4']);
  });
});

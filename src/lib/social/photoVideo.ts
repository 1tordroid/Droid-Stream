/**
 * FFmpeg arguments for "Video (photo with song)": a still photo, or a
 * slideshow of a carousel, over the song. Built here so they can be tested;
 * the native module only runs them.
 */

export type VideoEncoder = 'h264_mediacodec' | 'mpeg4';

export interface PhotoSongInput {
  /** Local photo files, in order. */
  images: string[];
  audio: string;
  output: string;
  /** Seconds of video to make. */
  duration: number;
  /** Where to start in the song, in seconds. */
  start?: number;
  /** Seconds each photo shows in a slideshow. */
  secondsPerImage?: number;
  crossfade?: boolean;
  /** Size of the first photo, used to pick the video size. */
  width?: number;
  height?: number;
  /** The phone's hardware H.264 encoder by default; MPEG-4 if that fails. */
  encoder?: VideoEncoder;
}

export const FPS = 30;
export const CROSSFADE_SECONDS = 0.5;
/** Most photos a slideshow uses before it holds the last one. */
export const MAX_CLIPS = 60;
const MAX_LONG_SIDE = 1920;
const MAX_SHORT_SIDE = 1080;

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** Video size: the photo's shape, at most 1080x1920, with even sides. */
export const canvasSize = (width?: number, height?: number): {width: number; height: number} => {
  if (!width || !height || width <= 0 || height <= 0) return {width: 1080, height: 1350};
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const scale = Math.min(1, MAX_LONG_SIDE / long, MAX_SHORT_SIDE / short);
  return {width: even(width * scale), height: even(height * scale)};
};

/** About 0.07 bits per pixel per frame for a mostly still picture, kept between 2 and 6 Mbit/s. */
export const videoBitrateKbps = (width: number, height: number, fps = FPS): number =>
  Math.round(Math.min(6000, Math.max(2000, (width * height * fps * 0.07) / 1000)));

const seconds = (value: number) => String(Math.round(value * 1000) / 1000);

export interface Clip {
  image: string;
  /** Seconds this clip lasts, including the part that fades into the next. */
  length: number;
}

/**
 * Photos in order, repeated to cover the song. With a crossfade, every clip
 * but the last runs half a second longer, so clip k starts at k * seconds.
 */
export const slideshowClips = (images: string[], duration: number, secondsPerImage: number, crossfade: boolean): Clip[] => {
  if (!images.length) return [];
  if (images.length === 1) return [{image: images[0], length: duration}];
  const each = Math.max(1, secondsPerImage);
  let count = Math.min(MAX_CLIPS, Math.max(1, Math.ceil(duration / each - 1e-9)));
  // The last clip must outlast the fade into it.
  if (crossfade && count > 1 && duration - (count - 1) * each < CROSSFADE_SECONDS + 0.1) count -= 1;
  const clips: Clip[] = [];
  for (let index = 0; index < count; index += 1) {
    const last = index === count - 1;
    clips.push({
      image: images[index % images.length],
      length: Math.round((last ? duration - (count - 1) * each : each + (crossfade ? CROSSFADE_SECONDS : 0)) * 1000) / 1000,
    });
  }
  return clips;
};

export const buildPhotoSongArgs = (input: PhotoSongInput): string[] => {
  if (!input.images.length) throw new Error('No photos for the video');
  const duration = Math.max(1, input.duration);
  const each = Math.max(1, input.secondsPerImage || 3);
  const crossfade = Boolean(input.crossfade) && input.images.length > 1;
  const {width, height} = canvasSize(input.width, input.height);
  const encoder = input.encoder || 'h264_mediacodec';
  const clips = slideshowClips(input.images, duration, each, crossfade);
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  // One still frame a second is read; the fps filter repeats it, which is far cheaper than decoding 30.
  for (const clip of clips) {
    args.push('-loop', '1', '-framerate', '1', '-t', String(Math.ceil(clip.length) + 1), '-i', clip.image);
  }
  if (input.start && input.start > 0) args.push('-ss', seconds(input.start));
  args.push('-i', input.audio);

  const filters = clips.map(
    (clip, index) =>
      `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS},` +
      `trim=duration=${seconds(clip.length)},setpts=PTS-STARTPTS,format=yuv420p[c${index}]`,
  );
  let last = 'c0';
  if (clips.length > 1 && crossfade) {
    for (let index = 1; index < clips.length; index += 1) {
      const out = `x${index}`;
      filters.push(`[${last}][c${index}]xfade=transition=fade:duration=${CROSSFADE_SECONDS}:offset=${seconds(index * each)}[${out}]`);
      last = out;
    }
  } else if (clips.length > 1) {
    filters.push(`${clips.map((_, index) => `[c${index}]`).join('')}concat=n=${clips.length}:v=1:a=0[joined]`);
    last = 'joined';
  }
  // The hardware encoder takes NV12; MPEG-4 takes planar YUV.
  filters.push(`[${last}]format=${encoder === 'h264_mediacodec' ? 'nv12' : 'yuv420p'}[v]`);

  args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', `${clips.length}:a:0`, '-t', seconds(duration));
  const bitrate = `${videoBitrateKbps(width, height)}k`;
  if (encoder === 'h264_mediacodec') {
    args.push('-c:v', 'h264_mediacodec', '-b:v', bitrate, '-g', String(FPS * 2));
  } else {
    args.push('-c:v', 'mpeg4', '-b:v', bitrate, '-g', String(FPS * 2));
  }
  args.push('-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-movflags', '+faststart', '-f', 'mp4', input.output);
  return args;
};

/** Seconds of song to use: the post's clip when it has one, else the rest of the song. */
export const songSegment = (
  songLength: number | undefined,
  start: number | undefined,
  clip: number | undefined,
  maxSeconds = 600,
): {start: number; duration: number} => {
  const from = Math.max(0, start || 0);
  const rest = songLength && songLength > from ? songLength - from : songLength || 0;
  let duration = clip && clip > 0 ? (rest ? Math.min(clip, rest) : clip) : rest;
  if (!duration || duration <= 0) duration = 30;
  return {start: songLength && from >= songLength ? 0 : from, duration: Math.min(duration, maxSeconds)};
};

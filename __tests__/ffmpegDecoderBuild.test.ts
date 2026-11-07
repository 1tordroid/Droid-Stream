import {describe, expect, it} from '@jest/globals';
import {createHash} from 'crypto';
import {readFileSync} from 'fs';
import {join} from 'path';
import {FFMPEG_DECODER_CONFIGURE, LICENSE_SECTION} from '../src/screens/settings/creditsData';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path));
const build = JSON.parse(read('native-src/android/decoder_ffmpeg/build.json').toString('utf8'));

describe('FFmpeg audio decoder build', () => {
  it('matches the libraries in jniLibs', () => {
    const libraries = Object.entries(build.libraries as Record<string, string>);
    expect(libraries.map(([path]) => path)).toEqual(expect.arrayContaining([
      'armeabi-v7a/libffmpegJNI.so', 'armeabi-v7a/libavcodec.so', 'armeabi-v7a/libswresample.so',
      'armeabi-v7a/libavutil.so', 'arm64-v8a/libffmpegJNI.so', 'x86_64/libffmpegJNI.so',
    ]));
    for (const [path, sha256] of libraries) {
      const actual = createHash('sha256').update(read(`native-src/android/jniLibs/${path}`)).digest('hex');
      expect(`${path} ${actual}`).toBe(`${path} ${sha256}`);
    }
  });

  it('was linked against the ffmpeg-kit and Media3 versions the app ships', () => {
    // On 64-bit ABIs libffmpegJNI.so uses ffmpeg-kit's libavcodec, so its ABI must match.
    const plugin = read('plugins/with-custom-native-modules.js').toString('utf8');
    expect(plugin).toContain(`ffmpeg-kit-https:${build.ffmpegKit}'`);
    expect(plugin).toContain(`details.useVersion '${build.media3}'`);
    const script = read('scripts/build-ffmpeg-decoder.sh').toString('utf8');
    expect(script).toContain(`FFMPEGKIT_VERSION=${build.ffmpegKit}\n`);
    expect(script).toContain(`FFMPEG_VERSION=${build.ffmpeg}\n`);
  });

  it('lists the exact FFmpeg configuration in the licences, without GPL or non-free parts', () => {
    expect(build.armeabiV7aConfigure).toBe(FFMPEG_DECODER_CONFIGURE);
    expect(FFMPEG_DECODER_CONFIGURE).not.toMatch(/--enable-(gpl|nonfree|version3)/);
    const entry = LICENSE_SECTION.items.find(item => item.name === 'FFmpeg audio decoders');
    expect(entry?.license).toBe('LGPL-2.1-or-later');
    expect(entry?.note).toContain(FFMPEG_DECODER_CONFIGURE);
    expect(entry?.links.map(link => link.url)).toContain(`https://ffmpeg.org/releases/ffmpeg-${build.ffmpeg}.tar.xz`);
  });
});

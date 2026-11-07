import {NativeModules, Platform} from 'react-native';

/** Native helpers of the built-in player (native-src/android/com/vega/PlayerToolsModule.kt). */
interface PlayerToolsNative {
  /** Chapters FFprobe finds in the file: start and end in seconds. */
  readChapters(source: string, headers: Record<string, string>): Promise<{start: number; end: number; title: string}[]>;
  /** Lines of the [ordinal]-th embedded subtitle track: start and end in ms. */
  readEmbeddedSubtitle(source: string, headers: Record<string, string>, ordinal: number): Promise<{start: number; end: number; text: string}[]>;
  /**
   * Loudness of the speech band, one value per 10 ms frame (dB, rounded), for
   * [durationSeconds] of audio from [startSeconds]. Decoded to 8 kHz mono.
   */
  readSpeechLevels(source: string, headers: Record<string, string>, startSeconds: number, durationSeconds: number): Promise<number[]>;
  cancelSpeechLevels(): void;
}

export const playerTools: PlayerToolsNative | undefined =
  Platform.OS === 'android' ? (NativeModules.PlayerToolsModule as PlayerToolsNative | undefined) : undefined;

/** Streams FFprobe and the subtitle reader can open: files, content URIs and plain HTTP(S) media. */
export const isProbeableSource = (uri: string | undefined, type?: string): boolean => {
  if (!uri) return false;
  if (type === 'm3u8' || type === 'mpd' || /\.(m3u8|mpd)(\?|$)/i.test(uri)) return false;
  return /^(https?:|file:|content:|\/)/i.test(uri);
};

export const isLocalSource = (uri: string | undefined): boolean => Boolean(uri) && /^(file:|content:|\/)/i.test(uri!);

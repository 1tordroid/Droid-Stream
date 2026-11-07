/** Names for audio formats in the player's audio menu, by MIME type. */
const FORMAT_NAMES: Record<string, string> = {
  'audio/mp4a-latm': 'AAC',
  'audio/ac3': 'AC3',
  'audio/eac3': 'E-AC3',
  'audio/eac3-joc': 'E-AC3 Atmos',
  'audio/ac4': 'AC-4',
  'audio/true-hd': 'TrueHD',
  'audio/vnd.dts': 'DTS',
  'audio/vnd.dts.hd': 'DTS-HD',
  'audio/vnd.dts.uhd;profile=p2': 'DTS:X',
  'audio/opus': 'Opus',
  'audio/vorbis': 'Vorbis',
  'audio/flac': 'FLAC',
  'audio/alac': 'ALAC',
  'audio/mpeg': 'MP3',
  'audio/mpeg-L1': 'MP1',
  'audio/mpeg-L2': 'MP2',
  'audio/raw': 'PCM',
  'audio/mha1': 'MPEG-H',
  'audio/mhm1': 'MPEG-H',
};

export interface AudioTrackFormat {
  /** The track's MIME type, as react-native-video reports it. */
  type?: string;
  /** Android: decoded by the app's FFmpeg decoder, not the device. */
  softwareDecoded?: boolean;
}

/**
 * The format part of an audio track's menu line, such as "DTS" or
 * "DTS · software" when the app decodes it instead of the device.
 */
export function audioTrackFormatLabel(track: AudioTrackFormat): string {
  const type = track.type?.trim();
  const name = type ? FORMAT_NAMES[type] ?? type.replace(/^audio\//, '') : '';
  if (!track.softwareDecoded) return name;
  return name ? `${name} · software` : 'software';
}

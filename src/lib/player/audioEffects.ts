/**
 * Night mode and dialogue boost: the choices, their saved names, and the
 * values the players take.
 *
 * The built-in Android player runs both effects natively (see the
 * react-native-video patch: NightModeCompressor, DialogueBoostMixer) and
 * changes them live. VLC has its own compressor filter, which only starts
 * with a new player, so it covers night mode only.
 */

export type NightMode = 'off' | 'light' | 'medium' | 'strong';
export type DialogueBoost = 'off' | 'on' | 'strong';

export type AudioEffectOption<T extends string> = {value: T; label: string};

export const NIGHT_MODE_OPTIONS: AudioEffectOption<NightMode>[] = [
  {value: 'off', label: 'Off'},
  {value: 'light', label: 'Light'},
  {value: 'medium', label: 'Medium'},
  {value: 'strong', label: 'Strong'},
];

export const DIALOGUE_BOOST_OPTIONS: AudioEffectOption<DialogueBoost>[] = [
  {value: 'off', label: 'Off'},
  {value: 'on', label: 'On'},
  {value: 'strong', label: 'Strong'},
];

export const DEFAULT_NIGHT_MODE: NightMode = 'off';
export const DEFAULT_DIALOGUE_BOOST: DialogueBoost = 'off';

export const NIGHT_MODE_HINT = 'Quieter loud scenes, clearer quiet speech';
export const DIALOGUE_BOOST_HINT = 'Makes voices stand out';
export const NIGHT_MODE_NEEDS_DECODED = 'Night mode needs decoded audio';
export const DIALOGUE_BOOST_NEEDS_DECODED = 'Dialogue boost needs decoded audio';
export const BUILT_IN_PLAYER_ONLY = 'Available in the built-in player';

export const isNightMode = (value: unknown): value is NightMode =>
  NIGHT_MODE_OPTIONS.some(option => option.value === value);

export const isDialogueBoost = (value: unknown): value is DialogueBoost =>
  DIALOGUE_BOOST_OPTIONS.some(option => option.value === value);

export const normalizeNightMode = (value: unknown): NightMode =>
  isNightMode(value) ? value : DEFAULT_NIGHT_MODE;

export const normalizeDialogueBoost = (value: unknown): DialogueBoost =>
  isDialogueBoost(value) ? value : DEFAULT_DIALOGUE_BOOST;

/** Native preset for the built-in player: 0 Off, 1 Light, 2 Medium, 3 Strong. */
export const nightModeNativeValue = (mode: NightMode): number =>
  Math.max(0, NIGHT_MODE_OPTIONS.findIndex(option => option.value === mode));

/** Native level for the built-in player: 0 Off, 1 On, 2 Strong. */
export const dialogueBoostNativeValue = (level: DialogueBoost): number =>
  Math.max(0, DIALOGUE_BOOST_OPTIONS.findIndex(option => option.value === level));

export const audioEffectLabel = <T extends string>(
  options: AudioEffectOption<T>[],
  value: T,
): string => options.find(option => option.value === value)?.label ?? 'Off';

/**
 * libVLC compressor settings per preset, close to the built-in player's.
 * Whole numbers only, so no locale can misread a decimal point.
 */
const VLC_COMPRESSOR: Record<Exclude<NightMode, 'off'>, Record<string, number>> = {
  light: {threshold: -20, ratio: 2, knee: 8, 'makeup-gain': 4, attack: 8, release: 250},
  medium: {threshold: -26, ratio: 3, knee: 8, 'makeup-gain': 7, attack: 6, release: 200},
  strong: {threshold: -30, ratio: 5, knee: 8, 'makeup-gain': 10, attack: 5, release: 150},
};

/** What the VLC screen always passed before night mode. */
const VLC_BASE_OPTIONS = ['--audio-time-stretch', '--sub-track=0'];

export type VlcSourceOptions = {initType?: 2; initOptions: string[]};

/**
 * Source options for react-native-vlc-media-player. Off keeps the old
 * source exactly. Any other preset starts libVLC with its compressor audio
 * filter: initType 2 is what makes the package pass initOptions to libVLC.
 *
 * The package (1.0.98) skips the last initOptions entry, so the filter
 * options go before the existing last entry, which stays as it was.
 */
export const vlcAudioSourceOptions = (mode: NightMode): VlcSourceOptions => {
  if (mode === 'off') return {initOptions: [...VLC_BASE_OPTIONS]};
  const compressor = Object.entries(VLC_COMPRESSOR[mode]).map(
    ([name, value]) => `--compressor-${name}=${value}`,
  );
  const last = VLC_BASE_OPTIONS[VLC_BASE_OPTIONS.length - 1];
  return {
    initType: 2,
    initOptions: [
      ...VLC_BASE_OPTIONS.slice(0, -1),
      '--audio-filter=compressor',
      '--compressor-rms-peak=0',
      ...compressor,
      last,
    ],
  };
};

/**
 * Look of the second subtitle line (dual subtitles): size, colour and where
 * it sits. The main subtitle keeps its own style from Subtitle style.
 */
import {mainStorage} from '../storage/StorageService';

export type SecondSubtitlePosition = 'above' | 'top';

export interface SecondSubtitleStyle {
  /** Text size in sp, like the main subtitle size. */
  fontSize: number;
  /** #RRGGBB */
  color: string;
  position: SecondSubtitlePosition;
}

const KEY = 'secondSubtitleStyle';

export const DEFAULT_SECOND_SUBTITLE_STYLE: SecondSubtitleStyle = {fontSize: 15, color: '#FFE082', position: 'above'};

export const SECOND_SUBTITLE_SIZES = [12, 14, 15, 16, 18, 20, 24, 28];

export const SECOND_SUBTITLE_COLORS: {value: string; label: string}[] = [
  {value: '#FFE082', label: 'Yellow'},
  {value: '#FFFFFF', label: 'White'},
  {value: '#80DEEA', label: 'Cyan'},
  {value: '#A5D6A7', label: 'Green'},
  {value: '#F48FB1', label: 'Pink'},
  {value: '#BDBDBD', label: 'Grey'},
];

export const normalizeSecondSubtitleStyle = (value: unknown): SecondSubtitleStyle => {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<SecondSubtitleStyle>;
  const fontSize = Number(raw.fontSize);
  return {
    fontSize: Number.isFinite(fontSize) && fontSize >= 8 && fontSize <= 48 ? fontSize : DEFAULT_SECOND_SUBTITLE_STYLE.fontSize,
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : DEFAULT_SECOND_SUBTITLE_STYLE.color,
    position: raw.position === 'top' ? 'top' : 'above',
  };
};

export const readSecondSubtitleStyle = (): SecondSubtitleStyle =>
  normalizeSecondSubtitleStyle(mainStorage.getObject<SecondSubtitleStyle>(KEY));

export const writeSecondSubtitleStyle = (style: SecondSubtitleStyle): void => {
  mainStorage.setObject(KEY, normalizeSecondSubtitleStyle(style));
};

/**
 * Distance of the second line from the bottom of the screen, in dp, so it
 * sits above two lines of the main subtitle.
 */
export const secondLineBottom = (mainFontSize: number, mainPaddingBottom: number): number =>
  Math.round(mainPaddingBottom + 4 + 2 * (mainFontSize * 1.35) + 2 * 5 + 12);

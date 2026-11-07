import * as Application from 'expo-application';
import Constants from 'expo-constants';
import {isTV} from './tv/constants';
import type {AppEdition} from './updates/release';

export type {AppEdition};

const EDITION_NAMES: Record<AppEdition, string> = {
  main: 'Droid Stream',
  ext: 'Droid Stream (with extension support)',
  tv: 'Droid Stream TV',
};

/** This build's edition, so updates never switch to another edition's APK. */
export const currentEdition = (): AppEdition => {
  const value = Constants.expoConfig?.extra?.appEdition;
  if (value === 'ext' || value === 'tv' || value === 'main') {
    return value;
  }
  return isTV ? 'tv' : 'main';
};

/** The app's name for an edition, as shown in Settings and About. */
export const editionName = (edition: AppEdition = currentEdition()): string =>
  EDITION_NAMES[edition] ?? EDITION_NAMES.main;

/** "5.6.0 (222)": versionName and versionCode, or whichever is known. */
export const versionWithBuild = (
  versionName: string | null | undefined = Application.nativeApplicationVersion,
  versionCode: string | null | undefined = Application.nativeBuildVersion,
): string => {
  const name = versionName?.trim() || '';
  const code = versionCode?.trim() || '';
  if (name && code) {
    return `${name} (${code})`;
  }
  return name || (code ? `(${code})` : '');
};

/** "Droid Stream 5.6.0 (222)", named by edition. */
export const versionLabel = (edition: AppEdition = currentEdition()): string =>
  [editionName(edition), versionWithBuild()].filter(Boolean).join(' ');

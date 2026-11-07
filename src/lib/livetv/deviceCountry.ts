/**
 * The country this phone or TV is in, for the World source in Live TV.
 *
 * Read on the device only, in this order: the SIM's country, the mobile
 * network's country, then the region in the language settings. No IP lookup
 * and no network call.
 */
import {NativeModules} from 'react-native';
import {findCountry, type Country} from './countries';

export type CountryFrom = 'sim' | 'network' | 'locale';

export interface DetectedCountry extends Country {
  from: CountryFrom;
}

export interface CountryHints {
  simCountry?: string;
  networkCountry?: string;
  localeCountry?: string;
}

const ORDER: [CountryFrom, keyof CountryHints][] = [
  ['sim', 'simCountry'],
  ['network', 'networkCountry'],
  ['locale', 'localeCountry'],
];

/** How the country was found, as shown next to it. */
export const DETECTED_FROM: Record<CountryFrom, string> = {
  sim: 'detected from your SIM',
  network: 'detected from your network',
  locale: "detected from your phone's language settings",
};

/** The first hint that is a known country: SIM, then network, then language region. */
export const pickDetectedCountry = (hints: CountryHints | undefined): DetectedCountry | undefined => {
  for (const [from, key] of ORDER) {
    const country = findCountry(hints?.[key]);
    if (country) return {...country, from};
  }
  return undefined;
};

const hintsFrom = (value: unknown): CountryHints | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : undefined);
  const hints = {simCountry: text('simCountry'), networkCountry: text('networkCountry'), localeCountry: text('localeCountry')};
  return Object.values(hints).some(item => item !== undefined) ? hints : undefined;
};

/** The hints from the native module (VegaDeviceMemory), when it is there. */
export const readCountryHints = (): CountryHints | undefined => {
  const module = NativeModules.VegaDeviceMemory;
  try {
    // Bridgeless interop exposes constants through getConstants(); the sync
    // method covers builds where constants are not forwarded.
    return hintsFrom(module) || hintsFrom(module?.getConstants?.()) || hintsFrom(module?.getCountryHints?.());
  } catch {
    return undefined;
  }
};

let detected: {value: DetectedCountry | undefined} | undefined;

/** The detected country, read once per launch. */
export const detectCountry = (): DetectedCountry | undefined => {
  if (!detected) detected = {value: pickDetectedCountry(readCountryHints())};
  return detected.value;
};

/** Tests only. */
export const resetDetectedCountryForTests = () => {
  detected = undefined;
};

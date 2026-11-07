import {DeviceEventEmitter, NativeModules, Platform} from 'react-native';
import type {BrowserEngineEvent} from './engine';

/**
 * The WebView engine's native hooks (BrowserModule.kt), used through
 * engines/webview.ts, plus the screen lock check for saved passwords. Every
 * call is optional: a build without the module still browses, without the
 * request hook (the page script then finds media and hides ads with CSS).
 */

interface BrowserNative {
  attach(tag: number, key: string, options: {autofill: boolean; passkeys: boolean}): Promise<boolean>;
  detach(key: string): void;
  loadFilters(path: string): Promise<number>;
  loadedFilters(): Promise<{path?: string | null; size: number}>;
  clearFilters(): void;
  setBlocking(enabled: boolean, allowlist: string[]): void;
  check(url: string, pageUrl: string, type: number): Promise<boolean>;
  blockedCount(key: string): Promise<number>;
  clearOrigins(origins: string[]): Promise<boolean>;
  authenticate(title: string, description: string): Promise<'ok' | 'cancelled' | 'no-lock'>;
  passkeyStatus(): Promise<'supported' | 'unsupported'>;
  flushCookies(): void;
}

const native = (): BrowserNative | undefined =>
  Platform.OS === 'android' ? (NativeModules.BrowserModule as BrowserNative | undefined) : undefined;

export const browserNativeAvailable = (): boolean => Boolean(native());

export const attachWebView = async (tag: number | null, key: string, options: {autofill: boolean; passkeys: boolean}): Promise<boolean> => {
  const module = native();
  if (!module || tag == null) return false;
  try {
    return await module.attach(tag, key, options);
  } catch {
    return false;
  }
};

export const detachWebView = (key: string): void => native()?.detach(key);

export const loadNativeFilters = async (path: string): Promise<number> => {
  const module = native();
  if (!module) return 0;
  const loaded = await module.loadedFilters().catch(() => ({path: null, size: 0}));
  if (loaded.path === path && loaded.size > 0) return loaded.size;
  return module.loadFilters(path);
};

export const reloadNativeFilters = async (path: string): Promise<number> => native()?.loadFilters(path) ?? 0;

export const clearNativeFilters = (): void => native()?.clearFilters();

export const setNativeBlocking = (enabled: boolean, allowlist: string[]): void => native()?.setBlocking(enabled, allowlist);

export const wouldBlock = async (url: string, pageUrl: string, type: number): Promise<boolean> =>
  (await native()?.check(url, pageUrl, type).catch(() => false)) ?? false;

export const clearOrigins = async (origins: string[]): Promise<void> => {
  if (origins.length) await native()?.clearOrigins(origins).catch(() => undefined);
};

/** Asks for the screen lock (or fingerprint). Resolves 'no-lock' when the phone has none. */
export const authenticate = async (title: string, description = ''): Promise<'ok' | 'cancelled' | 'no-lock'> => {
  const module = native();
  if (!module) return 'no-lock';
  try {
    return await module.authenticate(title, description);
  } catch {
    return 'cancelled';
  }
};

export const passkeysSupported = async (): Promise<boolean> =>
  (await native()?.passkeyStatus().catch(() => 'unsupported')) === 'supported';

export const flushCookies = (): void => native()?.flushCookies();

export const onBrowserEvent = (listener: (event: BrowserEngineEvent) => void): (() => void) => {
  const subscription = DeviceEventEmitter.addListener('BrowserEvent', listener);
  return () => subscription.remove();
};

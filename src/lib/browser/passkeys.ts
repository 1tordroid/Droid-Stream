import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import {Linking, Platform} from 'react-native';
import {browserJson, layoutSiteOf} from './store';

/**
 * Ways around passkeys failing in the built-in browser. Google Password
 * Manager only serves the browsers on its own list, so a passkey sign-in in
 * this WebView often fails. Two ways out: a passkey manager that lets you
 * trust any browser, or signing in with Chrome in a Custom Tab (that
 * sign-in then stays in Chrome).
 */

/** Passkey managers that let you allow any browser, this one included. */
export const PASSKEY_MANAGERS = ['Bitwarden', '1Password', 'Proton Pass', 'KeePassDX'] as const;

export interface PasskeyFailure {
  op: 'get' | 'create';
  error: 'NotAllowedError' | 'SecurityError' | 'NotSupportedError';
  url: string;
}

const FAILURE_ERRORS = new Set(['NotAllowedError', 'SecurityError', 'NotSupportedError']);

/** The page script's "passkeyFailed" message, checked, or null for anything else. */
export const passkeyFailureFrom = (message: unknown): PasskeyFailure | null => {
  if (!message || typeof message !== 'object') return null;
  const value = message as Record<string, unknown>;
  if (value.type !== 'passkeyFailed') return null;
  if (value.op !== 'get' && value.op !== 'create') return null;
  if (typeof value.error !== 'string' || !FAILURE_ERRORS.has(value.error)) return null;
  if (typeof value.url !== 'string' || !/^https:\/\//i.test(value.url)) return null;
  return {op: value.op, error: value.error as PasskeyFailure['error'], url: value.url};
};

// --- The tip shows at most once per site ---

const TIPS_KEY = 'passkeyTips';
const MAX_TIP_SITES = 300;

const readTips = (): Record<string, number> => browserJson.read<Record<string, number>>(TIPS_KEY, {});

export const shouldShowPasskeyTip = (url: string): boolean => {
  const site = layoutSiteOf(url);
  return Boolean(site) && !readTips()[site];
};

export const markPasskeyTipShown = (url: string, now = Date.now()): void => {
  const site = layoutSiteOf(url);
  if (!site) return;
  const entries = Object.entries({...readTips(), [site]: now})
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_TIP_SITES);
  browserJson.write(TIPS_KEY, Object.fromEntries(entries));
};

export const PASSKEY_TIP = {
  title: 'Passkey sign-in did not work',
  message:
    'Google Password Manager only works in browsers on its own list. Sign in with Chrome instead: the sign-in stays in Chrome, not in this browser. Or use a passkey manager that lets you trust any browser, such as Bitwarden, 1Password, Proton Pass or KeePassDX.',
};

export const CHROME_NOTE = 'Opens this page in Chrome. The sign-in stays in Chrome, not in this browser.';

// --- Sign in with Chrome ---

const VIEW = 'android.intent.action.VIEW';
// Asks the browser for a Custom Tab. Chrome checks only that the extra is there.
const CUSTOM_TAB_SESSION = 'android.support.customtabs.extra.SESSION';
const CHROME = {packageName: 'com.android.chrome', className: 'com.google.android.apps.chrome.IntentDispatcher'};
const ALREADY_OPEN = 'E_ACTIVITY_ALREADY_STARTED';

const codeOf = (error: unknown): string | undefined =>
  error && typeof error === 'object' && 'code' in error ? String((error as {code: unknown}).code) : undefined;

/**
 * Opens a page in a Chrome Custom Tab, or in the default browser's Custom
 * Tab when Chrome is not installed, or as a plain link as a last resort.
 * Resolves with how it opened; it does not wait for the tab to close.
 */
export const openInChrome = async (url: string): Promise<'chrome' | 'browser' | 'link' | 'failed'> => {
  if (!/^https?:\/\//i.test(url)) return 'failed';
  const extra = {[CUSTOM_TAB_SESSION]: false};
  const attempts: {result: 'chrome' | 'browser'; params: IntentLauncher.IntentLauncherParams}[] = [
    {result: 'chrome', params: {data: url, extra, ...CHROME}},
    {result: 'browser', params: {data: url, extra}},
  ];
  for (const attempt of attempts) {
    const opened = await startsActivity(VIEW, attempt.params);
    if (opened === 'busy') return 'failed';
    if (opened) return attempt.result;
  }
  try {
    await Linking.openURL(url);
    return 'link';
  } catch {
    return 'failed';
  }
};

/**
 * Starts an activity. IntentLauncher's promise settles only when the
 * activity closes, so a launch counts as done when it has not failed within
 * a moment; a missing activity fails at once.
 */
const startsActivity = (action: string, params: IntentLauncher.IntentLauncherParams, settleMs = 400): Promise<boolean | 'busy'> =>
  new Promise(resolve => {
    let done = false;
    const finish = (value: boolean | 'busy') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(true), settleMs);
    try {
      IntentLauncher.startActivityAsync(action, params).then(
        () => finish(true),
        error => finish(codeOf(error) === ALREADY_OPEN ? 'busy' : false),
      );
    } catch {
      finish(false);
    }
  });

// --- Choose a passkey manager ---

export type ProviderScreen = 'credential-provider' | 'accounts' | 'settings' | 'failed';

/**
 * Opens Android's passkey and password manager settings (Passwords, passkeys
 * and accounts, Android 14 and newer), falling back to Accounts and then to
 * Settings on older phones.
 */
export const openPasskeyProviderSettings = async (sdk: number = Number(Platform.Version) || 0): Promise<ProviderScreen> => {
  const attempts: {result: ProviderScreen; action: string; params: IntentLauncher.IntentLauncherParams}[] = [];
  if (sdk >= 34) {
    const packageName = Application.applicationId;
    if (packageName) attempts.push({result: 'credential-provider', action: 'android.settings.CREDENTIAL_PROVIDER', params: {data: `package:${packageName}`}});
    attempts.push({result: 'credential-provider', action: 'android.settings.CREDENTIAL_PROVIDER', params: {}});
  }
  attempts.push({result: 'accounts', action: 'android.settings.SYNC_SETTINGS', params: {}});
  attempts.push({result: 'settings', action: 'android.settings.SETTINGS', params: {}});
  for (const attempt of attempts) {
    const opened = await startsActivity(attempt.action, attempt.params);
    if (opened === 'busy') return 'failed';
    if (opened) return attempt.result;
  }
  return 'failed';
};

export const providerSettingsHint = (sdk: number = Number(Platform.Version) || 0): string =>
  sdk >= 34
    ? `Pick a passkey manager that lets you trust any browser, such as ${PASSKEY_MANAGERS.join(', ')}. Then allow Droid Stream in its settings.`
    : `Passkey managers other than Google need Android 14 or newer. On this phone, use Sign in with Chrome from the browser menu.`;

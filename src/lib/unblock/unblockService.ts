/**
 * Smart unblock: the saved mode, the hosts that needed ByeDPI or WARP, and
 * keeping the native router in step with both.
 */
import {DeviceEventEmitter, NativeModules, Platform, ToastAndroid} from 'react-native';
import {mainStorage} from '../storage/StorageService';
import {SettingsKeys, settingsStorage} from '../storage/SettingsStorage';
import {startByeDpi, stopByeDpi, DEFAULT_BYEDPI_ARGS} from '../services/byeDpiService';
import {startWarp, stopWarp} from '../services/warpService';
import {BLOCK_RULES} from './blockSignatures';
import {DEBRID_HOSTS, KEEP_DIRECT_HOSTS, normalizeHost} from './unblockHosts';
import {
  pruneRoutes,
  rememberRoute,
  resolveUnblockMode,
  type ProxyRoute,
  type RouteTable,
  type UnblockMode,
} from './routing';

const {DohModule} = NativeModules;

export const ROUTED_EVENT = 'SmartUnblockRouted';
export const FORGET_EVENT = 'SmartUnblockForget';

export const UNBLOCK_MODE_OPTIONS: readonly {value: UnblockMode; label: string; description: string}[] = [
  {value: 'auto', label: 'Auto (recommended)', description: 'Only blocked sites use ByeDPI or WARP'},
  {value: 'byedpi', label: 'Always ByeDPI', description: 'Every site goes through ByeDPI'},
  {value: 'warp', label: 'Always WARP', description: 'Every site except debrid goes through Cloudflare WARP'},
  {value: 'off', label: 'Off', description: 'Connect to every site directly'},
];

export const UNBLOCK_NOTICE_TEXT =
  'Sites your provider blocks open through ByeDPI or Cloudflare WARP, only for those sites. ' +
  'Debrid services always stay direct. WARP is run by Cloudflare and makes a free Cloudflare account the first time it is used.';

export const routeLabel = (route: ProxyRoute): string => (route === 'warp' ? 'WARP' : 'ByeDPI');

export const isUnblockSupported = (): boolean =>
  Platform.OS === 'android' && Boolean(DohModule?.configureUnblock);

const readBoolIfSaved = (key: string): boolean | undefined =>
  mainStorage.hasKey(key) ? mainStorage.getBool(key) : undefined;

/** The saved mode. Moves old WARP and ByeDPI switches over the first time. */
export const getUnblockMode = (): UnblockMode => {
  const resolved = resolveUnblockMode({
    stored: mainStorage.getString(SettingsKeys.UNBLOCK_MODE),
    warpEnabled: readBoolIfSaved(SettingsKeys.WARP_ENABLED),
    byeDpiEnabled: readBoolIfSaved(SettingsKeys.BYEDPI_ENABLED),
  });
  if (resolved.migrated) {
    mainStorage.setString(SettingsKeys.UNBLOCK_MODE, resolved.mode);
    if (resolved.warpConsent) mainStorage.setBool(SettingsKeys.UNBLOCK_WARP_CONSENT, true);
  }
  return resolved.mode;
};

export const hasWarpConsent = (): boolean =>
  mainStorage.getBool(SettingsKeys.UNBLOCK_WARP_CONSENT, false);

export const isUnblockNoticeSeen = (): boolean =>
  mainStorage.getBool(SettingsKeys.UNBLOCK_NOTICE_SEEN, false);

export const readRouteTable = (now = Date.now()): RouteTable =>
  pruneRoutes(mainStorage.getObject<RouteTable>(SettingsKeys.UNBLOCK_ROUTES) || {}, now);

const writeRouteTable = (table: RouteTable) => {
  mainStorage.setObject(SettingsKeys.UNBLOCK_ROUTES, table);
  routeListeners.forEach(listener => listener());
};

const routeListeners = new Set<() => void>();

/** Calls listener when the list of unblocked hosts changes. */
export const subscribeUnblockedHosts = (listener: () => void): (() => void) => {
  routeListeners.add(listener);
  return () => {
    routeListeners.delete(listener);
  };
};

export interface UnblockedHost {
  host: string;
  route: ProxyRoute;
  until: number;
}

export const listUnblockedHosts = (now = Date.now()): UnblockedHost[] =>
  Object.entries(readRouteTable(now))
    .map(([host, entry]) => ({host, route: entry.route, until: entry.until}))
    .sort((a, b) => a.host.localeCompare(b.host));

const nativeConfig = (mode: UnblockMode) => ({
  mode,
  warpConsent: hasWarpConsent(),
  byeDpiArgs: settingsStorage.getByeDpiCmdArgs() || DEFAULT_BYEDPI_ARGS,
  debridHosts: DEBRID_HOSTS,
  keepDirectHosts: KEEP_DIRECT_HOSTS,
  rules: BLOCK_RULES,
  routes: readRouteTable(),
});

let syncChain: Promise<void> = Promise.resolve();
let appliedMode: UnblockMode | undefined;

/**
 * Sends the mode, host lists and remembered routes to the router, then starts
 * the proxy an Always mode needs and stops the others. Auto starts each proxy
 * only when a blocked site needs it, so a running one is left alone unless
 * the mode just changed.
 */
export const syncUnblock = (): Promise<void> => {
  const run = async () => {
    if (!isUnblockSupported()) return;
    const mode = getUnblockMode();
    const table = readRouteTable();
    writeRouteTable(table);
    await DohModule.configureUnblock(JSON.stringify(nativeConfig(mode)));
    const modeChanged = appliedMode !== undefined && appliedMode !== mode;
    appliedMode = mode;
    if (mode === 'byedpi') {
      if (modeChanged) await stopWarp().catch(() => undefined);
      try {
        await startByeDpi();
      } catch (e) {
        console.warn('[Unblock] ByeDPI did not start:', e);
        ToastAndroid.show('ByeDPI did not start.', ToastAndroid.SHORT);
      }
    } else if (mode === 'warp') {
      if (modeChanged) await stopByeDpi().catch(() => undefined);
      try {
        await startWarp();
      } catch (e) {
        console.warn('[Unblock] WARP did not start:', e);
        ToastAndroid.show('WARP did not start.', ToastAndroid.SHORT);
      }
    } else if (mode === 'off' || modeChanged) {
      // Auto starts them again when a blocked site needs one.
      await Promise.all([stopByeDpi().catch(() => undefined), stopWarp().catch(() => undefined)]);
    }
  };
  syncChain = syncChain.then(run, run);
  return syncChain;
};

/** Saves a new mode. Choosing Auto or Always WARP here counts as agreeing to WARP. */
export const setUnblockMode = async (mode: UnblockMode): Promise<void> => {
  mainStorage.setString(SettingsKeys.UNBLOCK_MODE, mode);
  if (mode === 'auto' || mode === 'warp') mainStorage.setBool(SettingsKeys.UNBLOCK_WARP_CONSENT, true);
  await syncUnblock();
};

export const markUnblockNoticeSeen = (): void => {
  mainStorage.setBool(SettingsKeys.UNBLOCK_NOTICE_SEEN, true);
};

/** The user answered the first-start notice. */
export const answerUnblockNotice = async (mode: UnblockMode): Promise<void> => {
  markUnblockNoticeSeen();
  await setUnblockMode(mode);
};

export const forgetUnblockedHost = async (host: string): Promise<void> => {
  const name = normalizeHost(host);
  const table = readRouteTable();
  delete table[name];
  writeRouteTable(table);
  if (isUnblockSupported()) await DohModule.forgetUnblockHost(name).catch(() => undefined);
};

export interface UnblockStatus {
  mode: UnblockMode;
  byeDpiRunning: boolean;
  warpRunning: boolean;
}

export const getUnblockStatus = async (): Promise<UnblockStatus> => {
  const mode = getUnblockMode();
  if (!isUnblockSupported() || !DohModule.getUnblockStatus) {
    return {mode, byeDpiRunning: false, warpRunning: false};
  }
  const status = await DohModule.getUnblockStatus();
  return {mode, byeDpiRunning: Boolean(status?.byeDpiRunning), warpRunning: Boolean(status?.warpRunning)};
};

/** Collects hosts routed close together into one toast. */
export const toastText = (routed: {host: string; route: ProxyRoute}[]): string => {
  const routes = Array.from(new Set(routed.map(item => routeLabel(item.route))));
  const through = routes.join(' and ');
  if (routed.length === 1) return `${routed[0].host} looked blocked, opened through ${through}`;
  return `${routed.length} sites looked blocked, opened through ${through}`;
};

const TOAST_BATCH_MS = 1500;
const toastedThisSession = new Set<string>();
let pendingToasts: {host: string; route: ProxyRoute}[] = [];
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const queueToast = (host: string, route: ProxyRoute) => {
  if (toastedThisSession.has(host)) return;
  toastedThisSession.add(host);
  pendingToasts.push({host, route});
  if (toastTimer) return;
  toastTimer = setTimeout(() => {
    toastTimer = undefined;
    const batch = pendingToasts;
    pendingToasts = [];
    if (batch.length) ToastAndroid.show(toastText(batch), ToastAndroid.SHORT);
  }, TOAST_BATCH_MS);
};

/** Saves routes the router learned and shows the first-use toast. Returns a stop function. */
export const startUnblockEvents = (): (() => void) => {
  const routed = DeviceEventEmitter.addListener(
    ROUTED_EVENT,
    (event: {host?: string; route?: string; learned?: boolean}) => {
      const host = normalizeHost(event?.host || '');
      const route = event?.route;
      if (!host || (route !== 'byedpi' && route !== 'warp')) return;
      if (event.learned) writeRouteTable(rememberRoute(readRouteTable(), host, route, Date.now()));
      queueToast(host, route);
    },
  );
  const forgot = DeviceEventEmitter.addListener(FORGET_EVENT, (event: {host?: string}) => {
    const host = normalizeHost(event?.host || '');
    if (!host) return;
    const table = readRouteTable();
    if (!table[host]) return;
    delete table[host];
    writeRouteTable(table);
  });
  return () => {
    routed.remove();
    forgot.remove();
  };
};

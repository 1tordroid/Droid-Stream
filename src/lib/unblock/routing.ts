/**
 * Smart unblock routing rules. The native router (SmartUnblock.kt) follows
 * the same rules for every request; these functions are the reference and
 * are what the tests check.
 */
import {isDebridHost, isKeepDirectHost, isLocalHost, normalizeHost} from './unblockHosts';

export type UnblockMode = 'auto' | 'byedpi' | 'warp' | 'off';
export type UnblockRoute = 'direct' | 'byedpi' | 'warp';
export type ProxyRoute = Exclude<UnblockRoute, 'direct'>;

export const UNBLOCK_MODES: readonly UnblockMode[] = ['auto', 'byedpi', 'warp', 'off'];

/** A route that worked is kept this long, then direct is tried again. */
export const UNBLOCK_ROUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface RememberedRoute {
  route: ProxyRoute;
  /** Epoch milliseconds after which direct is tested again. */
  until: number;
}

export type RouteTable = Record<string, RememberedRoute>;

export const isUnblockMode = (value: unknown): value is UnblockMode =>
  typeof value === 'string' && (UNBLOCK_MODES as readonly string[]).includes(value);

export interface LegacyNetworkSettings {
  /** The saved mode, if any. */
  stored?: string;
  /** Old WARP switch; undefined when it was never saved. */
  warpEnabled?: boolean;
  /** Old ByeDPI switch; undefined when it was never saved. */
  byeDpiEnabled?: boolean;
}

/**
 * The mode to use. Someone who turned WARP or ByeDPI on before 5.6.0 keeps it
 * as Always WARP or Always ByeDPI. ByeDPI used to be on by default without
 * being saved; only a saved choice counts, so everyone else moves to Auto.
 */
export const resolveUnblockMode = (
  settings: LegacyNetworkSettings,
): {mode: UnblockMode; migrated: boolean; warpConsent: boolean} => {
  if (isUnblockMode(settings.stored)) {
    return {mode: settings.stored, migrated: false, warpConsent: false};
  }
  if (settings.warpEnabled === true) return {mode: 'warp', migrated: true, warpConsent: true};
  if (settings.byeDpiEnabled === true) return {mode: 'byedpi', migrated: true, warpConsent: false};
  return {mode: 'auto', migrated: true, warpConsent: false};
};

export interface RouteContext {
  mode: UnblockMode;
  /** The user agreed once to WARP making a Cloudflare account. */
  warpConsent: boolean;
  remembered?: RememberedRoute;
  now: number;
}

/**
 * The routes a request to host may take, in the order they are tried. The
 * next one is only used when the one before looked blocked.
 */
export const planRoute = (host: string, context: RouteContext): UnblockRoute[] => {
  const name = normalizeHost(host);
  if (!name || isLocalHost(name) || context.mode === 'off') return ['direct'];
  if (context.mode === 'byedpi') return ['byedpi'];
  const debrid = isDebridHost(name);
  if (context.mode === 'warp') {
    if (debrid) return ['direct', 'byedpi'];
    if (isKeepDirectHost(name)) return ['direct', 'byedpi', 'warp'];
    return ['warp'];
  }
  const allowed: UnblockRoute[] =
    debrid || !context.warpConsent ? ['direct', 'byedpi'] : ['direct', 'byedpi', 'warp'];
  const remembered = context.remembered;
  if (remembered && remembered.until > context.now && allowed.includes(remembered.route)) {
    return allowed.slice(allowed.indexOf(remembered.route));
  }
  return allowed;
};

/** Drops routes that expired or that are no longer allowed for their host. */
export const pruneRoutes = (table: RouteTable, now: number): RouteTable => {
  const next: RouteTable = {};
  for (const [host, entry] of Object.entries(table || {})) {
    if (!entry || entry.until <= now) continue;
    if (entry.route !== 'byedpi' && entry.route !== 'warp') continue;
    if (entry.route === 'warp' && isDebridHost(host)) continue;
    next[host] = entry;
  }
  return next;
};

export const rememberRoute = (
  table: RouteTable,
  host: string,
  route: UnblockRoute,
  now: number,
): RouteTable => {
  const name = normalizeHost(host);
  const next = {...table};
  if (route === 'direct' || (route === 'warp' && isDebridHost(name))) {
    delete next[name];
  } else {
    next[name] = {route, until: now + UNBLOCK_ROUTE_TTL_MS};
  }
  return next;
};

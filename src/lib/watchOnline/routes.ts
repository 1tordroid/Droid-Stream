/**
 * Watch online: the ways a magnet or torrent can play now, in the order they
 * are tried. A debrid service that already has it cached plays at once; then
 * PikPak fetches it in the cloud; then the torrent streams on this device.
 * Debrid services that do not have it cached can still be picked by hand.
 * Pure functions, original code.
 */
import type {DebridId} from '../debrid/types';

export type WatchRoute =
  | {kind: 'debrid'; service: DebridId; name: string; cached: boolean}
  | {kind: 'pikpak'}
  | {kind: 'torrent'};

export interface WatchRoutePlan {
  /** Tried one after another until one plays. */
  auto: WatchRoute[];
  /** Shown as other choices; never started by themselves. */
  others: WatchRoute[];
}

export interface WatchRouteInput {
  /** Connected debrid services, preferred first (PikPak is left out here). */
  services: {id: DebridId; name: string; canCheckCache: boolean}[];
  /** Services whose cache check said this torrent is ready. */
  cachedOn: DebridId[];
  /** Signed in to PikPak. */
  pikpak: boolean;
  /** A magnet or info hash is known; debrid and PikPak need one. */
  hasMagnet: boolean;
  /** The on-device torrent engine can take this (a magnet or a .torrent link). */
  canStream: boolean;
}

export const routeKey = (route: WatchRoute): string => (route.kind === 'debrid' ? `debrid:${route.service}` : route.kind);

export const planWatchRoutes = (input: WatchRouteInput): WatchRoutePlan => {
  const auto: WatchRoute[] = [];
  const others: WatchRoute[] = [];
  if (input.hasMagnet) {
    for (const service of input.services) {
      if (service.id === 'pikpak') continue;
      const cached = input.cachedOn.includes(service.id);
      (cached ? auto : others).push({kind: 'debrid', service: service.id, name: service.name, cached});
    }
    if (input.pikpak) auto.push({kind: 'pikpak'});
  }
  if (input.canStream) auto.push({kind: 'torrent'});
  return {auto, others};
};

export const routeLabel = (route: WatchRoute): string =>
  route.kind === 'debrid' ? `${route.name}${route.cached ? ' (cached)' : ''}` : route.kind === 'pikpak' ? 'PikPak cloud' : 'Torrent on this device';

export const routeDetail = (route: WatchRoute): string =>
  route.kind === 'debrid'
    ? route.cached
      ? 'Ready on the service. Plays at once.'
      : 'Not cached. The service downloads it first.'
    : route.kind === 'pikpak'
      ? 'PikPak downloads it in the cloud, then it plays from there.'
      : 'Plays while it downloads on this device. Peers can see your IP.';

/** The route after `current` in the automatic order, for falling back when one fails. */
export const nextRoute = (plan: WatchRoutePlan, current: WatchRoute): WatchRoute | undefined => {
  const index = plan.auto.findIndex(route => routeKey(route) === routeKey(current));
  return index >= 0 ? plan.auto[index + 1] : undefined;
};

/**
 * Jellyfin Quick Connect: this device asks the server for a 6-digit code,
 * the user enters it in Jellyfin (Settings > Quick Connect) on a device that
 * is already signed in, and this device then trades the approved request
 * for its own access token. No password is typed on the TV.
 *
 * Written from Jellyfin's public REST API. Emby has no Quick Connect.
 */
import {DeviceCodeStopError, type DeviceCode, type PollResult} from '../watchSync';
import {EXPIRED_MESSAGE} from '../watchSync/devicePoll';
import {deviceHeader} from './mediaServers';

/** How often the request is checked. */
export const QUICK_CONNECT_POLL_SECONDS = 3;
/** Jellyfin drops a Quick Connect request it has not seen approved within 10 minutes. */
export const QUICK_CONNECT_LIFETIME_MS = 10 * 60 * 1000;
export const QUICK_CONNECT_OFF_MESSAGE = 'Quick Connect is off on this server. Turn it on in the Jellyfin dashboard, or sign in with your password.';

const rootOf = (server: string) => server.replace(/\/+$/, '');

/** True when the server has Quick Connect turned on. False when it is off, old, or not Jellyfin. */
export const quickConnectEnabled = async (server: string, deviceId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${rootOf(server)}/QuickConnect/Enabled`, {headers: deviceHeader(deviceId)});
    if (!response.ok) return false;
    return (await response.json()) === true;
  } catch {
    return false;
  }
};

/**
 * Starts a Quick Connect request. Jellyfin 10.9 and later take POST; 10.8
 * took GET, so a refused POST is tried again as GET.
 */
export const startQuickConnect = async (server: string, deviceId: string, now = Date.now()): Promise<DeviceCode> => {
  const url = `${rootOf(server)}/QuickConnect/Initiate`;
  let response = await fetch(url, {method: 'POST', headers: deviceHeader(deviceId)});
  if (response.status === 404 || response.status === 405) response = await fetch(url, {headers: deviceHeader(deviceId)});
  if (response.status === 401 || response.status === 403) throw new Error(QUICK_CONNECT_OFF_MESSAGE);
  if (!response.ok) throw new Error(`Jellyfin did not give a code (${response.status}).`);
  const data = await response.json();
  const secret = data?.Secret;
  const code = data?.Code;
  if (typeof secret !== 'string' || !secret || code === undefined || code === null || String(code) === '') {
    throw new Error('Jellyfin did not give a code.');
  }
  return {
    userCode: String(code),
    verificationUrl: '',
    deviceCode: secret,
    intervalSeconds: QUICK_CONNECT_POLL_SECONDS,
    expiresAt: now + QUICK_CONNECT_LIFETIME_MS,
  };
};

/**
 * Checks the request once. Jellyfin answers 404 once it no longer knows the
 * request (expired or used), and 401 when Quick Connect was turned off.
 */
export const checkQuickConnect = async (server: string, code: DeviceCode, deviceId: string): Promise<PollResult> => {
  const response = await fetch(`${rootOf(server)}/QuickConnect/Connect?secret=${encodeURIComponent(code.deviceCode)}`, {
    headers: deviceHeader(deviceId),
  });
  if (response.status === 404) throw new DeviceCodeStopError(EXPIRED_MESSAGE);
  if (response.status === 401 || response.status === 403) throw new DeviceCodeStopError(QUICK_CONNECT_OFF_MESSAGE);
  if (!response.ok) throw new Error(`Jellyfin did not answer (${response.status}).`);
  const data = await response.json();
  return data?.Authenticated === true ? 'approved' : 'pending';
};

/** Trades an approved request for this device's sign-in. */
export const finishQuickConnect = async (
  server: string,
  code: DeviceCode,
  deviceId: string,
): Promise<{userId: string; token: string; userName: string}> => {
  const response = await fetch(`${rootOf(server)}/Users/AuthenticateWithQuickConnect`, {
    method: 'POST',
    headers: deviceHeader(deviceId),
    body: JSON.stringify({Secret: code.deviceCode}),
  });
  if (!response.ok) throw new Error(`Jellyfin sign-in failed (${response.status}). Try again.`);
  const data = await response.json();
  const userId = data?.User?.Id as string | undefined;
  const token = data?.AccessToken as string | undefined;
  if (!userId || !token) throw new Error('Jellyfin did not return a sign-in.');
  return {userId, token, userName: String(data?.User?.Name || '')};
};

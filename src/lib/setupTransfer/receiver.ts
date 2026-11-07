/**
 * Runs "Receive setup": makes a session, starts the one-time native server
 * on the home network and hands the first good setup to [onReceived].
 */
import type {SetupPayload} from '../backupSync/payload';
import {deviceName} from '../backupSync/payload';
import {syncNative} from '../backupSync/native';
import {SETUP_PORT} from './code';
import {createReceiveSession, MAX_TRANSFER_BYTES, type ReceiveSession} from './session';

export interface Receiving {
  session: ReceiveSession;
  address: string;
  port: number;
  stop: () => void;
}

const PORT_TRIES = 5;

export const startReceiving = async (
  onReceived: (payload: SetupPayload) => void,
  onExpired: () => void,
): Promise<Receiving> => {
  if (!syncNative.supported()) throw new Error('Update Droid Stream to use this');
  const session = await createReceiveSession(deviceName());
  let stopped = false;
  const subscription = syncNative.onRequest(({id, client, body}) => {
    session
      .handle(client, body)
      .then(result => {
        syncNative.respond(id, result.reply);
        if (result.received && !stopped) {
          stop();
          onReceived(result.received);
        }
      })
      .catch(() => syncNative.respond(id, JSON.stringify({ok: false, error: 'bad-request'})));
  });
  const timer = setTimeout(() => {
    if (stopped) return;
    stop();
    onExpired();
  }, Math.max(0, session.expiresAt - Date.now()));
  function stop() {
    if (stopped) return;
    stopped = true;
    session.close();
    clearTimeout(timer);
    subscription?.remove();
    syncNative.stopReceiver().catch(() => undefined);
  }
  let lastError = 'Connect to Wi-Fi to receive a setup';
  for (let attempt = 0; attempt < PORT_TRIES; attempt += 1) {
    const state = await syncNative.startReceiver(SETUP_PORT + attempt, MAX_TRANSFER_BYTES);
    if (state.running && state.address && state.port) {
      return {session, address: state.address, port: state.port, stop};
    }
    lastError = state.error || lastError;
    if (!/in use/i.test(lastError)) break;
  }
  stop();
  throw new Error(lastError);
};

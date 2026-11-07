/**
 * The native side of backup sync and setup transfer (SyncTransferModule.kt):
 * the network checks and the one-time receive server. The crypto calls are
 * in crypto.ts.
 */
import {NativeEventEmitter, NativeModules, Platform, type EmitterSubscription} from 'react-native';

const Native = NativeModules.SyncTransferModule;

export interface ReceiverState {
  running: boolean;
  address?: string;
  port?: number;
  error?: string;
}

export interface ReceiverRequest {
  id: string;
  client: string;
  body: string;
}

let emitter: NativeEventEmitter | undefined;

export const syncNative = {
  supported: (): boolean => Platform.OS === 'android' && Boolean(Native),
  /** True on Wi-Fi or Ethernet that is not metered. */
  isUnmetered: async (): Promise<boolean> => (Native ? Boolean(await Native.isUnmetered()) : true),
  /** This device's address on the home network, if any. */
  lanAddress: async (): Promise<string | undefined> => (Native ? (await Native.lanAddress()) || undefined : undefined),
  startReceiver: (port: number, maxBodyBytes: number): Promise<ReceiverState> =>
    Native ? Native.startReceiver(port, maxBodyBytes) : Promise.resolve({running: false, error: 'Update Droid Stream to use this'}),
  stopReceiver: (): Promise<void> => (Native ? Native.stopReceiver() : Promise.resolve()),
  respond: (id: string, body: string): void => {
    Native?.respond(id, body);
  },
  onRequest: (listener: (event: ReceiverRequest) => void): EmitterSubscription | undefined => {
    if (!Native) return undefined;
    emitter = emitter || new NativeEventEmitter(Native);
    return emitter.addListener('SyncTransferRequest', listener as (event: unknown) => void);
  },
};

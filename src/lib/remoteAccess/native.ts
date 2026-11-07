/**
 * The native side of remote access (RemoteAccessModule.kt): the LAN server,
 * the command receiver and the browser-like connection list.
 */
import * as Application from 'expo-application';
import {NativeEventEmitter, NativeModules, Platform, type EmitterSubscription} from 'react-native';

const Native = NativeModules.RemoteAccessModule;

export interface RpcServerState {
  running: boolean;
  address?: string;
  port?: number;
  /** Why the server is not running, in words for the user. */
  error?: string;
}

export interface RpcRequestEvent {
  id: string;
  client: string;
  body: string;
}

export interface CommandEvent {
  id: string;
  action: string;
  /** The broadcast's string extras, without the token. */
  extras: Record<string, string>;
}

let emitter: NativeEventEmitter | undefined;
const events = (): NativeEventEmitter | undefined => {
  if (!Native) return undefined;
  emitter = emitter || new NativeEventEmitter(Native);
  return emitter;
};

const listen = <T,>(name: string, listener: (event: T) => void): EmitterSubscription | undefined =>
  events()?.addListener(name, listener as (event: unknown) => void);

export const remoteAccessNative = {
  supported: (): boolean => Platform.OS === 'android' && Boolean(Native),
  /** This edition's package name, for the commands shown in Settings. */
  packageName: (): string => {
    const constants = Native?.getConstants?.() as {packageName?: string} | undefined;
    return constants?.packageName || Application.applicationId || 'com.tordroid.droidstream';
  },
  startServer: (port: number, maxBodyBytes: number): Promise<RpcServerState> =>
    Native ? Native.startServer(port, maxBodyBytes) : Promise.resolve({running: false, error: 'Not available on this device'}),
  stopServer: (): Promise<void> => (Native ? Native.stopServer() : Promise.resolve()),
  serverState: (): Promise<RpcServerState> => (Native ? Native.serverState() : Promise.resolve({running: false})),
  respond: (id: string, body: string | null): void => {
    Native?.respond(id, body);
  },
  /** True once after the user turned remote control off from its notification. */
  consumeStoppedFromNotification: (): Promise<boolean> =>
    Native ? Native.consumeStoppedFromNotification() : Promise.resolve(false),
  setCommandAccess: (enabled: boolean, token: string): Promise<void> =>
    Native ? Native.setCommandAccess(enabled, token) : Promise.resolve(),
  respondCommand: (id: string, ok: boolean, text: string): void => {
    Native?.respondCommand(id, ok, text);
  },
  /** ADD_DOWNLOAD commands that arrived while the app was closed, as JSON texts. */
  takePendingCommands: (): Promise<string[]> => (Native ? Native.takePendingCommands() : Promise.resolve([])),
  setBrowserLikeSites: (sites: string[], neverHosts: readonly string[]): Promise<void> =>
    Native ? Native.setBrowserLikeSites(sites, [...neverHosts]) : Promise.resolve(),
  onRequest: (listener: (event: RpcRequestEvent) => void) => listen('RemoteRpcRequest', listener),
  onCommand: (listener: (event: CommandEvent) => void) => listen('RemoteCommand', listener),
  onServerState: (listener: (event: RpcServerState) => void) => listen('RemoteRpcState', listener),
};

/** Speed limit for every HTTP-based download (HttpDownloadModule's shared limit). */
export const setGlobalSpeedLimit = (bytesPerSecond: number): void => {
  NativeModules.HttpDownloadModule?.setSpeedLimit?.(bytesPerSecond, null, 0)?.catch?.(() => undefined);
};

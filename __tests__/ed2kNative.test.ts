import {DeviceEventEmitter, NativeModules, Platform} from 'react-native';
import {
  ensureEd2kServers,
  importServerList,
  isEd2kCancelledError,
  isEd2kPausedError,
  isEd2kSupported,
  onEd2kProgress,
  searchEd2k,
} from '../src/lib/ed2k/native';
import {
  DEFAULT_SERVER_LIST_URL,
  addEd2kServers,
  preferEd2kServer,
  readEd2kServers,
  removeEd2kServer,
  saveEd2kServers,
} from '../src/lib/ed2k/settings';
import {formatEd2kStatus, useEd2kStatusStore} from '../src/lib/ed2k/status';

const native = {
  start: jest.fn(),
  pause: jest.fn(),
  cancel: jest.fn(),
  isActive: jest.fn(),
  search: jest.fn(),
  fetchServerList: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

beforeAll(() => {
  Platform.OS = 'android';
  NativeModules.Ed2kModule = native;
});

beforeEach(() => {
  jest.clearAllMocks();
  saveEd2kServers([]);
});

it('is available only with the native module', () => {
  expect(isEd2kSupported()).toBe(true);
});

it('keeps a list of servers without duplicates', () => {
  expect(addEd2kServers([{host: '1.2.3.4', port: 4661}, {host: '1.2.3.4', port: 4661}, {host: 'x', port: 0}])).toBe(1);
  expect(addEd2kServers([{host: '1.2.3.4', port: 4661}, {host: '5.6.7.8', port: 4242, name: 'B'}])).toBe(1);
  preferEd2kServer('5.6.7.8:4242');
  expect(readEd2kServers().map(server => server.host)).toEqual(['5.6.7.8', '1.2.3.4']);
  removeEd2kServer('5.6.7.8:4242');
  expect(readEd2kServers()).toEqual([{host: '1.2.3.4', port: 4661}]);
});

it('imports a server list', async () => {
  native.fetchServerList.mockResolvedValue([
    {host: '1.1.1.1', port: 4661, name: 'One', description: ''},
    {host: '2.2.2.2', port: 4242, name: '', description: ''},
  ]);
  await expect(importServerList('http://x/server.met')).resolves.toBe(2);
  expect(readEd2kServers()).toEqual([
    {host: '1.1.1.1', port: 4661, name: 'One'},
    {host: '2.2.2.2', port: 4242, name: undefined},
  ]);
  native.fetchServerList.mockResolvedValue([]);
  await expect(importServerList('http://x/empty.met')).rejects.toThrow('no servers');
});

it('fetches the default server list only when there are no servers', async () => {
  native.fetchServerList.mockResolvedValue([{host: '3.3.3.3', port: 4661}]);
  await expect(ensureEd2kServers()).resolves.toEqual([{host: '3.3.3.3', port: 4661, name: undefined}]);
  expect(native.fetchServerList).toHaveBeenCalledWith(DEFAULT_SERVER_LIST_URL);
  native.fetchServerList.mockClear();
  await ensureEd2kServers();
  expect(native.fetchServerList).not.toHaveBeenCalled();
});

it('explains when no server can be found', async () => {
  native.fetchServerList.mockRejectedValue(new Error('offline'));
  await expect(ensureEd2kServers()).rejects.toThrow('No eD2k servers');
});

it('searches with the saved servers, most sources first', async () => {
  saveEd2kServers([{host: '1.2.3.4', port: 4661}]);
  native.search.mockResolvedValue([
    {hash: 'a', name: 'a', size: 1, sources: 2, completeSources: 0},
    {hash: 'b', name: 'b', size: 1, sources: 9, completeSources: 1},
  ]);
  const results = await searchEd2k('  debian iso ');
  expect(native.search).toHaveBeenCalledWith('debian iso', [{host: '1.2.3.4', port: 4661}]);
  expect(results.map(result => result.hash)).toEqual(['b', 'a']);
  await expect(searchEd2k('   ')).resolves.toEqual([]);
});

it('tells pause and cancel apart', () => {
  expect(isEd2kPausedError({code: 'ED2K_PAUSED'})).toBe(true);
  expect(isEd2kCancelledError({code: 'ED2K_CANCELLED'})).toBe(true);
  expect(isEd2kPausedError(new Error('x'))).toBe(false);
});

it('delivers progress events', () => {
  const listener = jest.fn();
  const stop = onEd2kProgress(listener);
  DeviceEventEmitter.emit('VegaEd2kProgress', {downloadId: 'd', state: 'queued'});
  stop();
  DeviceEventEmitter.emit('VegaEd2kProgress', {downloadId: 'd', state: 'queued'});
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith({downloadId: 'd', state: 'queued'});
});

describe('status line', () => {
  const base = {sources: 0, downloading: 0, queueRank: 0, message: ''};
  it('describes each state plainly', () => {
    expect(formatEd2kStatus({...base, state: 'downloading', sources: 5, downloading: 2})).toBe('eD2k · 2 of 5 sources sending');
    expect(formatEd2kStatus({...base, state: 'queued', sources: 1, queueRank: 17})).toBe('eD2k · Waiting in queue (17) · 1 source');
    expect(formatEd2kStatus({...base, state: 'waitingForNetwork', message: 'Waiting for Wi-Fi'})).toBe('eD2k · Waiting for Wi-Fi');
    expect(formatEd2kStatus({...base, state: 'connecting'})).toBe('eD2k · Connecting to a server');
    expect(formatEd2kStatus({...base, state: 'searching'})).toBe('eD2k · Looking for sources');
    expect(formatEd2kStatus({...base, state: 'searching', sources: 3})).toBe('eD2k · 3 sources, connecting');
  });

  it('keeps one line per download', () => {
    const store = useEd2kStatusStore.getState();
    store.set('a', 'one');
    store.set('a', 'two');
    expect(useEd2kStatusStore.getState().status).toEqual({a: 'two'});
    store.clear('a');
    expect(useEd2kStatusStore.getState().status).toEqual({});
  });
});

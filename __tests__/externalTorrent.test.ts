import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const appStateListeners: ((state: string) => void)[] = [];
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: (_: string, listener: (state: string) => void) => {
      appStateListeners.push(listener);
      return {remove: () => appStateListeners.splice(appStateListeners.indexOf(listener), 1)};
    },
  },
}));

const engine = new Set<string>();
const mockTorrentManager = {
  addTorrent: jest.fn(async (link: string) => {
    const infoHash = link.replace('magnet:?xt=urn:btih:', '');
    engine.add(infoHash);
    return {infoHash};
  }),
  deleteTorrent: jest.fn(async (hash: string) => {
    engine.delete(hash);
  }),
  getFiles: jest.fn(async () => [
    {index: 0, name: 'sample.txt', path: 'a', size: 9_000},
    {index: 1, name: 'film.mkv', path: 'b', size: 5_000},
  ]),
  prepareVideoFile: jest.fn(async () => true),
  getStreamUrl: jest.fn(async (hash: string, index: number) => `http://127.0.0.1:8090/stream/${hash}/${index}`),
  listTorrents: jest.fn(async () => [...engine].map(infoHash => ({infoHash}))),
  keepEngineInForeground: jest.fn(async () => {}),
  releaseEngineForeground: jest.fn(async () => {}),
};
jest.mock('../src/lib/torrentManager', () => ({
  get torrentManager() {
    return mockTorrentManager;
  },
}));

let mockStored: {infoHash: string}[] = [];
jest.mock('../src/lib/torrent/settings', () => ({readStoredTorrents: () => mockStored}));
jest.mock('../src/lib/storage/SettingsStorage', () => ({
  settingsStorage: {keepDirectTorrentFile: () => false, isTorrentFullDownload: () => false},
}));
let mockDownloads: Record<string, {status: string; torrentInfoHash?: string; backendJobId?: string}> = {};
jest.mock('../src/lib/zustand/downloadsStore', () => ({
  __esModule: true,
  default: {getState: () => ({downloads: mockDownloads})},
}));

import {externalPlayerUrl, isTorrentHeldElsewhere, releaseExternalTorrents} from '../src/lib/externalTorrent';

const returnToApp = () => {
  [...appStateListeners].forEach(listener => listener('background'));
  [...appStateListeners].forEach(listener => listener('active'));
};
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('external player torrents', () => {
  beforeEach(async () => {
    mockStored = [];
    mockDownloads = {};
    await releaseExternalTorrents();
    engine.clear();
    jest.clearAllMocks();
  });

  it('passes non-torrent links through unchanged', async () => {
    await expect(externalPlayerUrl({link: 'https://cdn/video.mp4'})).resolves.toBe('https://cdn/video.mp4');
    expect(mockTorrentManager.addTorrent).not.toHaveBeenCalled();
  });

  it('plays the largest video from the local stream server and removes it on return', async () => {
    const url = await externalPlayerUrl({link: 'magnet:?xt=urn:btih:aaa'});
    expect(url).toBe('http://127.0.0.1:8090/stream/aaa/1');
    expect(mockTorrentManager.keepEngineInForeground).toHaveBeenCalled();
    returnToApp();
    await flush();
    expect(mockTorrentManager.deleteTorrent).toHaveBeenCalledWith('aaa', true);
    expect(mockTorrentManager.releaseEngineForeground).toHaveBeenCalled();
  });

  it('never deletes a torrent a download owns', async () => {
    await externalPlayerUrl({link: 'magnet:?xt=urn:btih:bbb'});
    await externalPlayerUrl({link: 'magnet:?xt=urn:btih:ccc', type: 'torrent'});
    mockDownloads = {d1: {status: 'downloading', backendJobId: 'ccc'}};
    expect(mockTorrentManager.deleteTorrent).toHaveBeenCalledWith('bbb', true);
    mockTorrentManager.releaseEngineForeground.mockClear();
    returnToApp();
    await flush();
    expect(mockTorrentManager.deleteTorrent).not.toHaveBeenCalledWith('ccc', expect.anything());
    expect(mockTorrentManager.releaseEngineForeground).not.toHaveBeenCalled();
  });

  it('does not take over a torrent the Torrents tab already holds', async () => {
    mockStored = [{infoHash: 'DDD'}];
    expect(isTorrentHeldElsewhere('ddd')).toBe(true);
    await externalPlayerUrl({link: 'magnet:?xt=urn:btih:ddd'});
    mockStored = [];
    await releaseExternalTorrents();
    expect(mockTorrentManager.deleteTorrent).not.toHaveBeenCalled();
  });

  it('treats a completed download as no longer holding the torrent', () => {
    mockDownloads = {d1: {status: 'completed', torrentInfoHash: 'eee'}};
    expect(isTorrentHeldElsewhere('eee')).toBe(false);
  });
});

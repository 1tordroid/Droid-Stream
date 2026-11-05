const mockAddTorrent = jest.fn(() => Promise.resolve({infoHash: 'a'}));
const mockInitEngine = jest.fn(() => Promise.resolve({streamPort: 8080}));
const mockApplySettings = jest.fn(() => Promise.resolve());

jest.mock('react-native', () => ({
  Platform: {OS: 'android'},
  NativeModules: {
    TorrentModule: {
      initEngine: (...args: unknown[]) => (mockInitEngine as any)(...args),
      addTorrent: (...args: unknown[]) => (mockAddTorrent as any)(...args),
    },
    TorrentClientModule: {
      applySettings: (...args: unknown[]) => (mockApplySettings as any)(...args),
    },
  },
}));

import {torrentManager} from '../src/lib/torrentManager';

describe('torrent engine start', () => {
  it('applies the rules before any waiting torrent is added', async () => {
    const order: string[] = [];
    let finishPrepare = () => {};
    torrentManager.setBeforeFirstTorrent(async () => {
      await torrentManager.applySettings({dht: true});
      order.push('rules');
      await new Promise<void>(resolve => {
        finishPrepare = resolve;
      });
    });
    mockAddTorrent.mockImplementation(() => {
      order.push('torrent');
      return Promise.resolve({infoHash: 'a'});
    });

    expect(torrentManager.engineRunning).toBe(false);
    const first = torrentManager.addTorrent('magnet:?xt=urn:btih:a');
    const second = torrentManager.addTorrent('magnet:?xt=urn:btih:b');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(order).toEqual(['rules']);

    finishPrepare();
    await Promise.all([first, second]);
    expect(order).toEqual(['rules', 'torrent', 'torrent']);
    expect(mockInitEngine).toHaveBeenCalledTimes(1);
    expect(torrentManager.engineRunning).toBe(true);
  });
});

const mockInitEngine = jest.fn();

jest.mock('react-native', () => ({
  Platform: {OS: 'android'},
  NativeModules: {
    TorrentModule: {initEngine: (...args: unknown[]) => mockInitEngine(...args)},
    TorrentClientModule: {},
  },
}));

import {torrentManager} from '../src/lib/torrentManager';
import {
  isTorrentEngineUnavailable,
  withoutUnplayableTorrents,
} from '../src/lib/torrentStream';

it('stops offering torrent streams after the engine fails to load', async () => {
  const streams = [
    {link: 'magnet:?xt=urn:btih:a', type: 'torrent'},
    {link: 'https://example.com/a.mp4', type: 'mp4'},
  ];
  expect(withoutUnplayableTorrents(streams)).toHaveLength(2);

  mockInitEngine.mockRejectedValueOnce(
    Object.assign(new Error('dlopen failed'), {code: 'INIT_ERROR'}),
  );
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(torrentManager.init()).rejects.toThrow('dlopen failed');

  expect(isTorrentEngineUnavailable()).toBe(true);
  expect(withoutUnplayableTorrents(streams)).toEqual([streams[1]]);
});

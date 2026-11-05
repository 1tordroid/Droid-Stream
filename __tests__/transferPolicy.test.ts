jest.mock('../src/lib/downloadManager', () => ({scheduleQueuedDownloads: jest.fn(() => Promise.resolve())}));
jest.mock('../src/lib/torrent/settings', () => ({
  readTorrentSettings: jest.fn(),
  readStoredTorrents: jest.fn(() => []),
  writeStoredTorrents: jest.fn(),
  writeTorrentSettings: jest.fn(),
}));
jest.mock('../src/lib/downloadEngine/queueStore', () => {
  let open = true;
  return {transfersOpen: () => open, setTransfersOpen: (value: boolean) => { open = value; }};
});
jest.mock('../src/lib/torrentManager', () => ({
  torrentManager: {
    engineRunning: false,
    networkStatus: jest.fn(),
    setTransfersAllowed: jest.fn(() => Promise.resolve()),
    applySettings: jest.fn(() => Promise.resolve()),
    applyBlocklist: jest.fn(() => Promise.resolve()),
    enqueue: jest.fn(),
  },
}));

import {scheduleQueuedDownloads} from '../src/lib/downloadManager';
import {transfersOpen} from '../src/lib/downloadEngine/queueStore';
import {readTorrentSettings} from '../src/lib/torrent/settings';
import {checkTransferRules, decideTransfers} from '../src/lib/torrent/transferPolicy';
import {torrentManager} from '../src/lib/torrentManager';

const settings = (patch = {}) => ({
  wifiOnly: true,
  chargingOnly: false,
  pauseOnBatterySaver: false,
  requireVpn: false,
  scheduleEnabled: false,
  windows: [],
  rssFeeds: [],
  blocklist: '',
  ...patch,
}) as any;
const network = (patch = {}) => ({wifi: false, charging: false, powerSave: false, vpn: false, vpnAddress: '', ...patch}) as any;
const NOW = new Date(2026, 10, 5, 12, 0);

describe('decideTransfers', () => {
  it('holds only torrents on mobile data with Wi-Fi only on', () => {
    expect(decideTransfers(settings(), network(), NOW)).toEqual({torrents: false, downloads: true});
  });

  it('holds only torrents when the VPN kill switch trips', () => {
    expect(decideTransfers(settings({wifiOnly: false, requireVpn: true}), network(), NOW)).toEqual({torrents: false, downloads: true});
  });

  it('holds everything outside the schedule', () => {
    const decision = decideTransfers(settings({wifiOnly: false, scheduleEnabled: true, windows: []}), network(), NOW);
    expect(decision).toEqual({torrents: false, downloads: false});
  });
});

describe('checkTransferRules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (torrentManager as any).engineRunning = false;
    (torrentManager.networkStatus as jest.Mock).mockResolvedValue(network({wifi: true}));
  });

  it('does not touch engine settings when the engine is not running', async () => {
    (readTorrentSettings as jest.Mock).mockReturnValue(settings());
    await checkTransferRules(NOW);
    expect(torrentManager.setTransfersAllowed).toHaveBeenCalledWith(true);
    expect(torrentManager.applySettings).not.toHaveBeenCalled();
  });

  it('applies settings once while the engine runs', async () => {
    (torrentManager as any).engineRunning = true;
    (readTorrentSettings as jest.Mock).mockReturnValue(settings());
    await checkTransferRules(NOW);
    await checkTransferRules(NOW);
    expect(torrentManager.applySettings).toHaveBeenCalledTimes(1);
  });

  it('restarts queued downloads when the schedule opens', async () => {
    (readTorrentSettings as jest.Mock).mockReturnValue(settings({scheduleEnabled: true, windows: []}));
    await checkTransferRules(NOW);
    expect(transfersOpen()).toBe(false);
    expect(scheduleQueuedDownloads).not.toHaveBeenCalled();
    (readTorrentSettings as jest.Mock).mockReturnValue(settings());
    await checkTransferRules(NOW);
    expect(transfersOpen()).toBe(true);
    expect(scheduleQueuedDownloads).toHaveBeenCalledTimes(1);
  });
});

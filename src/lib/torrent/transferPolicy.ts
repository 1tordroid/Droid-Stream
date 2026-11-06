/**
 * Runs the torrent and download rules from app start, not only after the
 * Torrents tab opens. Checking the rules never starts the torrent engine, so
 * people who do not use torrents never join the swarm.
 */
import {AppState} from 'react-native';
import {scheduleQueuedDownloads} from '../downloadManager';
import {transferAllowed} from '../downloadEngine/planner';
import {setTransfersOpen, transfersOpen} from '../downloadEngine/queueStore';
import {torrentManager, type NetworkStatus} from '../torrentManager';
import {feedItemMatches, parseFeedLinks} from './rss';
import {readStoredTorrents, readTorrentSettings, writeStoredTorrents, writeTorrentSettings, type TorrentSettings} from './settings';

const ENGINE_CHECK_MS = 3000;
const IDLE_CHECK_MS = 30000;
// Feeds are polled at most every 15 minutes, not on every check.
const RSS_INTERVAL_MS = 15 * 60 * 1000;

/** Wi-Fi, charging, battery, and VPN rules are torrent settings. The schedule covers all downloads. */
export const decideTransfers = (settings: TorrentSettings, network: NetworkStatus, now: Date) => {
  const schedule = {scheduleEnabled: settings.scheduleEnabled, windows: settings.windows, now};
  return {
    torrents: transferAllowed({
      ...schedule,
      wifiOnly: settings.wifiOnly,
      onWifi: network.wifi,
      chargingOnly: settings.chargingOnly,
      charging: network.charging,
      pauseOnBatterySaver: settings.pauseOnBatterySaver,
      powerSave: network.powerSave,
      requireVpn: settings.requireVpn,
      vpnConnected: network.vpn,
    }).allowed,
    downloads: transferAllowed({
      ...schedule,
      wifiOnly: false,
      onWifi: network.wifi,
      chargingOnly: false,
      charging: network.charging,
      pauseOnBatterySaver: false,
      powerSave: network.powerSave,
      requireVpn: false,
      vpnConnected: network.vpn,
    }).allowed,
  };
};

let appliedSettings = '';
let appliedBlocklist = '';
let lastRssCheck = 0;

const applyToEngine = async (settings: TorrentSettings, network: NetworkStatus): Promise<void> => {
  const next = {
    downloadRateLimit: settings.downloadRateLimit,
    uploadRateLimit: settings.uploadRateLimit,
    maxActiveDownloads: settings.maxActiveDownloads,
    maxActiveSeeds: settings.maxActiveSeeds,
    seedingEnabled: settings.seedingEnabled,
    seedTimeLimitSeconds: settings.seedTimeLimitSeconds,
    shareRatioPercent: settings.shareRatioPercent,
    dht: settings.dht,
    lsd: settings.lsd,
    pex: settings.pex,
    utp: settings.utp,
    encryption: settings.encryption,
    proxyType: settings.proxyType,
    proxyHost: settings.proxyHost,
    proxyPort: settings.proxyPort,
    proxyUsername: settings.proxyUsername,
    proxyPassword: settings.proxyPassword,
    publicTrackers: settings.publicTrackers,
    bindAddress: settings.requireVpn ? network.vpnAddress : '',
  };
  const key = JSON.stringify(next);
  if (key !== appliedSettings) {
    await torrentManager.applySettings(next);
    appliedSettings = key;
  }
  if (settings.blocklist && settings.blocklist !== appliedBlocklist) {
    await torrentManager.applyBlocklist(settings.blocklist);
    appliedBlocklist = settings.blocklist;
  }
};

const checkFeeds = async (settings: TorrentSettings): Promise<void> => {
  if (!settings.rssFeeds.length || Date.now() - lastRssCheck < RSS_INTERVAL_MS) return;
  lastRssCheck = Date.now();
  for (const feed of settings.rssFeeds) {
    if (!/^https?:\/\//i.test(feed.url)) continue;
    try {
      const xml = await (await fetch(feed.url)).text();
      const fresh = parseFeedLinks(xml).filter(item => feedItemMatches(item.title, feed.keywords) && !feed.seen.includes(item.link));
      for (const item of fresh) {
        const added = await torrentManager.enqueue(item.link);
        writeStoredTorrents([{infoHash: added.infoHash, source: item.link, name: item.title}, ...readStoredTorrents()]);
        feed.seen.push(item.link);
        feed.seen = feed.seen.slice(-500);
      }
    } catch {
      // A feed that fails waits for the next check.
    }
  }
  writeTorrentSettings(settings);
};

let checking = false;

export const checkTransferRules = async (now = new Date()): Promise<void> => {
  if (checking) return;
  checking = true;
  try {
    const settings = readTorrentSettings();
    const network = await torrentManager.networkStatus();
    const decision = decideTransfers(settings, network, now);
    const wasOpen = transfersOpen();
    setTransfersOpen(decision.downloads);
    // Queued downloads start again as soon as the schedule allows them.
    if (decision.downloads && !wasOpen) scheduleQueuedDownloads().catch(() => undefined);
    await torrentManager.setTransfersAllowed(decision.torrents);
    if (torrentManager.engineRunning) await applyToEngine(settings, network);
    await checkFeeds(settings);
  } finally {
    checking = false;
  }
};

/** Starts the checks. Returns a function that stops them. */
export const startTransferRules = (): (() => void) => {
  // The first torrent waits for this, so the VPN kill switch and proxy are set before it connects.
  torrentManager.setBeforeFirstTorrent(async () => {
    const settings = readTorrentSettings();
    const network = await torrentManager.networkStatus();
    await torrentManager.setTransfersAllowed(decideTransfers(settings, network, new Date()).torrents);
    await applyToEngine(settings, network);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (timer) clearTimeout(timer);
    checkTransferRules()
      .catch(() => undefined)
      .finally(() => {
        timer = setTimeout(run, torrentManager.engineRunning ? ENGINE_CHECK_MS : IDLE_CHECK_MS);
      });
  };
  run();
  const subscription = AppState.addEventListener('change', state => {
    if (state === 'active') run();
  });
  return () => {
    if (timer) clearTimeout(timer);
    subscription.remove();
    torrentManager.setBeforeFirstTorrent(undefined);
  };
};

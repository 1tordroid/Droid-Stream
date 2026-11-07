import {ToastAndroid} from 'react-native';
import {formatDownloadBytes} from '../downloadFormatting';
import {showAppDialog} from '../zustand/appDialogStore';
import useDownloadsStore from '../zustand/downloadsStore';
import {normalizeEd2kLink, parseEd2kLink, type Ed2kFileLink, type Ed2kLink} from './link';
import {importServerList, isEd2kSupported} from './native';
import {addEd2kServers, isEd2kEnabled, setEd2kEnabled} from './settings';

const extensionOf = (name: string): string => {
  const match = name.match(/\.([a-z0-9]{1,8})$/i);
  return match ? match[1].toLowerCase() : 'bin';
};

/** Adds an eD2k file to the downloads list. */
export const queueEd2kFile = async (
  link: Ed2kFileLink,
  rawLink: string,
): Promise<'queued' | 'duplicate'> => {
  const downloads = Object.values(useDownloadsStore.getState().downloads);
  const duplicate = downloads.some(item => {
    if (item.sourceType !== 'ed2k') return false;
    const existing = parseEd2kLink(item.url);
    return existing?.kind === 'file' && existing.hash === link.hash;
  });
  if (duplicate) {
    return 'duplicate';
  }
  // Loaded on use: the download manager pulls in notifications and storage.
  const {downloadManager} = require('../downloader') as typeof import('../downloader');
  const extension = extensionOf(link.name);
  const baseName = link.name.replace(/\.[a-z0-9]{1,8}$/i, '') || link.name;
  await downloadManager({
    downloadId: `ed2k-${link.hash}`,
    title: baseName,
    mediaType: 'movie',
    // The original link keeps its peers and part hashes.
    url: normalizeEd2kLink(rawLink),
    fileName: baseName,
    fileType: extension,
    provider: 'eD2k',
    deleteDownload: () => undefined,
  });
  return 'queued';
};

/** What a link did, as a short message for a toast. */
export const handleEd2kLink = async (
  link: Ed2kLink,
  rawLink: string,
): Promise<string> => {
  if (link.kind === 'server') {
    return addEd2kServers([{host: link.host, port: link.port}]) > 0
      ? 'eD2k server added'
      : 'That eD2k server is already in the list';
  }
  if (link.kind === 'serverlist') {
    const added = await importServerList(link.url);
    return `${added} eD2k server${added === 1 ? '' : 's'} added`;
  }
  return (await queueEd2kFile(link, rawLink)) === 'queued'
    ? 'Added to Downloads'
    : 'Already in Downloads';
};

const describe = (link: Ed2kLink): {title: string; message: string; action: string} => {
  if (link.kind === 'server') {
    return {title: 'Add eD2k server?', message: `${link.host}:${link.port}`, action: 'Add'};
  }
  if (link.kind === 'serverlist') {
    return {title: 'Import eD2k servers?', message: link.url, action: 'Import'};
  }
  return {
    title: 'Download eD2k file?',
    message: `${link.name}\n${formatDownloadBytes(link.size)}`,
    action: 'Download',
  };
};

/**
 * Asks before acting on an eD2k link that was shared, opened or copied.
 * When eD2k is off, the same dialog offers to turn it on.
 */
export const offerEd2kLink = (rawLink: string, origin: 'shared' | 'clipboard'): void => {
  const link = parseEd2kLink(rawLink);
  if (!link || !isEd2kSupported()) return;
  const enabled = isEd2kEnabled();
  // Copied links are only offered to people who use eD2k.
  if (!enabled && origin === 'clipboard') return;
  const {title, message, action} = describe(link);
  showAppDialog({
    title,
    message: enabled ? message : `${message}\n\neD2k downloads are off. This turns them on.`,
    actions: [
      {label: 'Not now'},
      {
        label: enabled ? action : `Turn on and ${action.toLowerCase()}`,
        variant: 'primary',
        onPress: () => {
          if (!enabled) setEd2kEnabled(true);
          handleEd2kLink(link, rawLink)
            .then(text => ToastAndroid.show(text, ToastAndroid.SHORT))
            .catch(error => ToastAndroid.show(error?.message || 'That eD2k link did not work', ToastAndroid.LONG));
        },
      },
    ],
  });
};

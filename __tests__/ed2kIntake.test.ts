const mockDownloadManager = jest.fn(async () => undefined);
let mockDownloads: Record<string, unknown> = {};
const mockImport = jest.fn();

jest.mock('../src/lib/downloader', () => ({downloadManager: (args: unknown) => mockDownloadManager(args)}));
jest.mock('../src/lib/zustand/downloadsStore', () => ({
  __esModule: true,
  default: {getState: () => ({downloads: mockDownloads})},
}));
jest.mock('../src/lib/ed2k/native', () => ({
  importServerList: (url: string) => mockImport(url),
  isEd2kSupported: () => true,
}));

import {handleEd2kLink, queueEd2kFile} from '../src/lib/ed2k/intake';
import {parseEd2kLink, type Ed2kFileLink} from '../src/lib/ed2k/link';
import {readEd2kServers, saveEd2kServers} from '../src/lib/ed2k/settings';

const HASH = '965c013e991ee246d63d45ea71954c4d';

beforeEach(() => {
  jest.clearAllMocks();
  mockDownloads = {};
  saveEd2kServers([]);
});

it('queues a file with a stable id and its own extension', async () => {
  const raw = `ed2k://%7Cfile%7CDebian.Netinst.iso%7C661651456%7C${HASH}%7C/`;
  const link = parseEd2kLink(raw) as Ed2kFileLink;
  await expect(queueEd2kFile(link, raw)).resolves.toBe('queued');
  expect(mockDownloadManager).toHaveBeenCalledWith(expect.objectContaining({
    downloadId: `ed2k-${HASH}`,
    title: 'Debian.Netinst',
    fileName: 'Debian.Netinst',
    fileType: 'iso',
    url: `ed2k://|file|Debian.Netinst.iso|661651456|${HASH}|/`,
    provider: 'eD2k',
  }));
});

it('does not add the same file twice', async () => {
  mockDownloads = {x: {sourceType: 'ed2k', url: `ed2k://|file|other name.iso|5|${HASH}|/`}};
  const raw = `ed2k://|file|a.iso|5|${HASH}|/`;
  await expect(queueEd2kFile(parseEd2kLink(raw) as Ed2kFileLink, raw)).resolves.toBe('duplicate');
  expect(mockDownloadManager).not.toHaveBeenCalled();
});

it('adds servers and imports server lists from links', async () => {
  const server = 'ed2k://|server|1.2.3.4|4661|/';
  await expect(handleEd2kLink(parseEd2kLink(server)!, server)).resolves.toBe('eD2k server added');
  await expect(handleEd2kLink(parseEd2kLink(server)!, server)).resolves.toBe('That eD2k server is already in the list');
  expect(readEd2kServers()).toEqual([{host: '1.2.3.4', port: 4661}]);
  mockImport.mockResolvedValue(3);
  const list = 'ed2k://|serverlist|http://example.org/server.met|/';
  await expect(handleEd2kLink(parseEd2kLink(list)!, list)).resolves.toBe('3 eD2k servers added');
  expect(mockImport).toHaveBeenCalledWith('http://example.org/server.met');
});

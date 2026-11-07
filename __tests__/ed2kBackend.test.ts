const mockUpdateDownload = jest.fn();
const mockUpdateProgress = jest.fn();
const mockCleanup = jest.fn(async () => undefined);
let mockProgress: ((event: unknown) => void) | undefined;
const mockStart = jest.fn();
const mockPause = jest.fn(async () => undefined);
const mockCancel = jest.fn(async () => undefined);
const mockEnsureServers = jest.fn();
let mockEnabled = true;

jest.mock('../src/lib/zustand/downloadsStore', () => ({
  __esModule: true,
  default: {getState: () => ({updateDownload: mockUpdateDownload, updateProgress: mockUpdateProgress})},
}));
jest.mock('../src/lib/downloadDestination', () => ({cleanupDownloadStaging: (id: string) => mockCleanup(id)}));
jest.mock('../src/lib/torrent/settings', () => ({readTorrentSettings: () => ({wifiOnly: true})}));
jest.mock('../src/lib/ed2k/settings', () => ({isEd2kEnabled: () => mockEnabled}));
jest.mock('../src/lib/ed2k/native', () => ({
  ensureEd2kServers: () => mockEnsureServers(),
  startEd2kTransfer: (...args: unknown[]) => mockStart(...args),
  pauseEd2kTransfer: (id: string) => mockPause(id),
  cancelEd2kTransfer: (id: string) => mockCancel(id),
  onEd2kProgress: (listener: (event: unknown) => void) => {
    mockProgress = listener;
    return () => {
      mockProgress = undefined;
    };
  },
  isEd2kPausedError: (error: any) => error?.code === 'ED2K_PAUSED',
  isEd2kCancelledError: (error: any) => error?.code === 'ED2K_CANCELLED',
}));

import {ed2kDownloadBackend} from '../src/lib/downloadBackends/ed2kBackend';
import {DownloadPausedError} from '../src/lib/downloadBackends/types';
import {useEd2kStatusStore} from '../src/lib/ed2k/status';

const HASH = '965c013e991ee246d63d45ea71954c4d';
const context = (url: string) => ({
  record: {id: 'ed2k-1', url} as any,
  destination: {stagingDirectory: '/cache/downloads/x', stagingPath: '/cache/downloads/x/file.iso.part'},
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEnabled = true;
  mockEnsureServers.mockResolvedValue([{host: '1.2.3.4', port: 4661}]);
});

it('starts the native transfer into the staging file and reports progress', async () => {
  let finish: () => void = () => undefined;
  mockStart.mockImplementation(() => new Promise<void>(resolve => (finish = resolve)));
  const running = ed2kDownloadBackend.start(
    context(`ed2k://|file|file.iso|5000|${HASH}|/|sources,9.9.9.9:4662|/`),
  );
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(mockStart).toHaveBeenCalledWith(
    'ed2k-1',
    {
      hash: HASH,
      size: 5000,
      path: '/cache/downloads/x/file.iso.part',
      sources: ['9.9.9.9:4662'],
      partHashes: undefined,
      wifiOnly: true,
    },
    [{host: '1.2.3.4', port: 4661}],
  );
  expect(mockUpdateDownload).toHaveBeenCalledWith('ed2k-1', expect.objectContaining({status: 'downloading', totalBytes: 5000, canPause: true}));
  mockProgress?.({downloadId: 'other', downloadedBytes: 1, totalBytes: 2, speed: 3});
  mockProgress?.({downloadId: 'ed2k-1', downloadedBytes: 100, totalBytes: 5000, speed: 50, state: 'queued', sources: 2, downloading: 0, queueRank: 4, message: ''});
  expect(mockUpdateProgress).toHaveBeenCalledTimes(1);
  expect(mockUpdateProgress).toHaveBeenCalledWith('ed2k-1', 100, 5000, 50);
  expect(useEd2kStatusStore.getState().status['ed2k-1']).toBe('eD2k · Waiting in queue (4) · 2 sources');
  finish();
  await running;
  expect(mockProgress).toBeUndefined();
  expect(useEd2kStatusStore.getState().status['ed2k-1']).toBeUndefined();
});

it('turns a native pause into a paused download', async () => {
  mockStart.mockRejectedValue(Object.assign(new Error('Download paused'), {code: 'ED2K_PAUSED'}));
  await expect(ed2kDownloadBackend.start(context(`ed2k://|file|a.iso|10|${HASH}|/`))).rejects.toBeInstanceOf(DownloadPausedError);
});

it('works from link sources alone when no server is known', async () => {
  mockEnsureServers.mockRejectedValue(new Error('No eD2k servers'));
  mockStart.mockResolvedValue({totalBytes: 10});
  await ed2kDownloadBackend.start(context(`ed2k://|file|a.iso|10|${HASH}|/|sources,9.9.9.9:4662|/`));
  expect(mockStart.mock.calls[0][2]).toEqual([]);
  await expect(ed2kDownloadBackend.start(context(`ed2k://|file|a.iso|10|${HASH}|/`))).rejects.toThrow('No eD2k servers');
});

it('refuses when eD2k is off or the link is not a file', async () => {
  await expect(ed2kDownloadBackend.start(context('ed2k://|server|1.2.3.4|4661|/'))).rejects.toThrow('not an eD2k file link');
  mockEnabled = false;
  await expect(ed2kDownloadBackend.start(context(`ed2k://|file|a.iso|10|${HASH}|/`))).rejects.toThrow('eD2k downloads are off');
  expect(mockStart).not.toHaveBeenCalled();
});

it('pauses, cancels and cleans up through the native module', async () => {
  await ed2kDownloadBackend.pause!('ed2k-1');
  await ed2kDownloadBackend.cancel('ed2k-1');
  await ed2kDownloadBackend.cleanup('ed2k-1');
  expect(mockPause).toHaveBeenCalledWith('ed2k-1');
  expect(mockCancel).toHaveBeenCalledWith('ed2k-1');
  expect(mockCleanup).toHaveBeenCalledWith('ed2k-1');
  expect(ed2kDownloadBackend.restartOnResume).toBe(true);
  expect(ed2kDownloadBackend.preserveStagingOnFailure).toBe(true);
});

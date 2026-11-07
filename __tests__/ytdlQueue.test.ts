const mockBackendStart = jest.fn(async () => undefined);

jest.mock('../src/lib/downloadBackends/registry', () => ({
  getDownloadBackend: (source: string) => ({
    preserveStagingOnFailure: source === 'ytdlp',
    restartOnResume: source === 'ytdlp',
    start: mockBackendStart,
    pause: jest.fn(async () => undefined),
    resume: jest.fn(async () => undefined),
    cancel: jest.fn(async () => undefined),
    cleanup: jest.fn(async () => undefined),
  }),
}));

jest.mock('../src/lib/downloadDestination', () => ({
  prepareDownloadDestination: async () => ({
    stagingDirectory: '/cache/downloads/v',
    stagingPath: '/cache/downloads/v/Video.mp4.part',
  }),
  finalizeDownloadOutput: async () => ({filePath: 'content://downloads/Video.mp4', size: 100}),
  cleanupDownloadStaging: async () => undefined,
}));

jest.mock('../src/lib/downloadLocation', () => ({
  ensureDownloadLocationAccess: async (location: unknown) => location,
  isSafDownloadLocation: () => true,
  getDownloadFileName: (name: string, type: string) => `${name}.${type}`,
}));

jest.mock('../src/lib/services/Notification', () => ({
  notificationService: {
    ensureDownloadPermission: jest.fn(async () => true),
    startForegroundTask: jest.fn(),
    stopForegroundTask: jest.fn(async () => undefined),
    showDownloadStarting: jest.fn(async () => undefined),
    showDownloadQueued: jest.fn(async () => undefined),
    showDownloadProgress: jest.fn(async () => undefined),
    showDownloadComplete: jest.fn(async () => undefined),
    showDownloadFailed: jest.fn(async () => undefined),
    cancelNotification: jest.fn(async () => undefined),
  },
}));

jest.mock('../src/lib/imageAccent', () => ({getImageAccent: jest.fn(async () => '#ffffff')}));

jest.mock('../src/lib/storage', () => ({
  settingsStorage: {
    getDownloadLocationConfig: () => undefined,
    getDownloadConcurrency: () => 3,
    isAutoDownloadServerFallbackEnabled: () => false,
    getPrimaryColor: () => '#ffffff',
    setDownloadLocation: jest.fn(),
  },
}));

jest.mock('../src/lib/torrentManager', () => ({torrentManager: {isOnWifi: async () => true}}));

jest.mock('react-native-mmkv-storage', () => ({
  MMKVLoader: class {
    withInstanceID() {
      return this;
    }
    initialize() {
      return {
        getString: () => undefined,
        setString: () => undefined,
        getBool: () => undefined,
        setBool: () => undefined,
        getInt: () => undefined,
        setInt: () => undefined,
        removeItem: () => undefined,
        clearStore: () => undefined,
      };
    }
  },
}));

import {describe, expect, it, beforeEach} from '@jest/globals';
import {scheduleQueuedDownloads} from '../src/lib/downloadManager';
import {buildYtdlArgs} from '../src/lib/ytdl/args';
import {ProgressAggregator, cleanYtdlError, stageLabel} from '../src/lib/ytdl/progress';
import {buildYtdlRecords} from '../src/lib/ytdl/queue';
import {deferralReason, nextTimeAt, setLastKnownWifi} from '../src/lib/ytdl/schedule';
import type {YtdlRequest} from '../src/lib/ytdl/types';
import useDownloadsStore, {type DownloadItem} from '../src/lib/zustand/downloadsStore';

const request: YtdlRequest = {
  kind: 'video',
  maxHeight: 720,
  container: 'mp4',
  audioFormat: 'm4a',
  subtitleMode: 'off',
  subtitleLanguages: [],
  autoSubtitles: false,
  embedThumbnail: false,
  embedMetadata: true,
  embedChapters: false,
  sponsorBlock: 'off',
  sponsorCategories: [],
};

const location = {type: 'saf' as const, uri: 'content://downloads/tree', label: 'Downloads'};
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

let counter = 0;
const makeId = () => `ytdl-test-${++counter}`;

describe('buildYtdlRecords', () => {
  it('makes one queued record per item, grouped under the folder and playlist', () => {
    const {records, duplicates} = buildYtdlRecords(
      [
        {url: 'https://youtu.be/1', title: ' First ', index: 1, playlist: 'Mix', thumbnail: 'https://i/1.jpg'},
        {url: 'https://youtu.be/2', title: '', index: 2, playlist: 'Mix'},
        {url: 'https://youtu.be/1', title: 'First again', index: 3, playlist: 'Mix'},
      ],
      request,
      {notBefore: 1000, wifiOnly: true, qualityLabel: '720p', templateArgs: '--limit-rate 1M -o x'},
      [],
      'Video downloads',
      makeId,
    );
    expect(duplicates).toBe(1);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(
      expect.objectContaining({
        title: 'First',
        showName: 'Video downloads',
        seasonTitle: 'Mix',
        episodeIndex: 1,
        sourceType: 'ytdlp',
        provider: 'yt-dlp',
        videoType: 'mp4',
        displayFileName: 'First.mp4',
        poster: 'https://i/1.jpg',
        status: 'queued',
        quality: '720p',
      }),
    );
    expect(records[1].title).toBe('Video');
    const spec = records[0].ytdl!;
    expect(spec).toEqual(expect.objectContaining({kind: 'video', ext: 'mp4', notBefore: 1000, wifiOnly: true, playlist: 'Mix'}));
    // The template is appended, without the output path it tried to set.
    expect(spec.args.slice(-2)).toEqual(['--limit-rate', '1M']);
    expect(spec.args).not.toContain('-o');
  });

  it('skips an item that is still in the queue with the same options', () => {
    const args = buildYtdlArgs(request);
    const existing = [{id: 'old', url: 'https://youtu.be/1', sourceType: 'ytdlp', status: 'paused', ytdl: {args, kind: 'video'}}] as DownloadItem[];
    expect(buildYtdlRecords([{url: 'https://youtu.be/1', title: 'A'}], request, {}, existing, '', makeId)).toEqual({records: [], duplicates: 1});
    // A finished one, or other options, may be downloaded again.
    const finished = [{...existing[0], status: 'completed'}] as DownloadItem[];
    expect(buildYtdlRecords([{url: 'https://youtu.be/1', title: 'A'}], request, {}, finished, '', makeId).records).toHaveLength(1);
    expect(buildYtdlRecords([{url: 'https://youtu.be/1', title: 'A'}], {...request, kind: 'audio'}, {}, existing, '', makeId).records).toHaveLength(1);
  });

  it('names original audio m4a until the real type is known', () => {
    const {records} = buildYtdlRecords([{url: 'https://youtu.be/9', title: 'Song'}], {...request, kind: 'audio', audioFormat: 'best'}, {}, [], 'Music', makeId);
    expect(records[0]).toEqual(expect.objectContaining({videoType: 'm4a', showName: 'Music'}));
    expect(records[0].ytdl?.ext).toBeUndefined();
  });
});

describe('scheduled and Wi-Fi-only downloads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDownloadsStore.setState({downloads: {}, storageFullHold: false});
    setLastKnownWifi(true);
  });

  const queue = (id: string, ytdl: DownloadItem['ytdl']) =>
    useDownloadsStore.getState().enqueueDownload({
      id,
      title: id,
      type: 'series',
      url: `https://youtu.be/${id}`,
      sourceType: 'ytdlp',
      videoType: 'mp4',
      downloadLocation: location,
      status: 'queued',
      ytdl,
    });

  it('starts only what is due and allowed on this network', async () => {
    setLastKnownWifi(false);
    queue('later', {args: [], kind: 'video', notBefore: Date.now() + 3_600_000});
    queue('wifi', {args: [], kind: 'video', wifiOnly: true});
    queue('now', {args: [], kind: 'video'});
    await scheduleQueuedDownloads();
    await flush();
    const started = mockBackendStart.mock.calls.map(call => (call as unknown as [{record: DownloadItem}])[0].record.id);
    expect(started).toEqual(['now']);
    expect(useDownloadsStore.getState().downloads.later.status).toBe('queued');
    expect(useDownloadsStore.getState().downloads.wifi.status).toBe('queued');

    setLastKnownWifi(true);
    await scheduleQueuedDownloads();
    await flush();
    const after = mockBackendStart.mock.calls.map(call => (call as unknown as [{record: DownloadItem}])[0].record.id);
    expect(after).toEqual(['now', 'wifi']);
  });

  it('explains the wait', () => {
    const now = new Date(2026, 10, 7, 20, 0).getTime();
    expect(deferralReason({notBefore: new Date(2026, 10, 7, 23, 5).getTime()}, now, true)).toBe('Starts at 23:05');
    expect(deferralReason({notBefore: new Date(2026, 10, 8, 1, 0).getTime()}, now, true)).toBe('Starts 8/11 at 01:00');
    expect(deferralReason({wifiOnly: true}, now, false)).toBe('Waiting for Wi-Fi');
    expect(deferralReason({wifiOnly: true, notBefore: now - 1}, now, true)).toBeUndefined();
    expect(deferralReason(undefined, now, false)).toBeUndefined();
  });

  it('finds the next start time', () => {
    const now = new Date(2026, 10, 7, 20, 0).getTime();
    expect(nextTimeAt(21, 30, now)).toBe(new Date(2026, 10, 7, 21, 30).getTime());
    expect(nextTimeAt(19, 0, now)).toBe(new Date(2026, 10, 8, 19, 0).getTime());
  });
});

describe('ProgressAggregator', () => {
  const event = (patch: Partial<{file: string; status: 'downloading' | 'finished'; downloaded: number; total: number; speed: number; planned: number; parts: number; fragment: number; fragments: number}>) => ({
    type: 'progress' as const,
    status: 'downloading' as const,
    file: 'media.f137.mp4',
    downloaded: 0,
    total: 0,
    speed: 0,
    planned: 0,
    parts: 1,
    ...patch,
  });

  it('adds the video and audio files into one total that never goes back', () => {
    const progress = new ProgressAggregator();
    expect(progress.update(event({downloaded: 50, total: 900, speed: 10, planned: 1000, parts: 2}))).toEqual({downloaded: 50, total: 1000, speed: 10, eta: 95});
    expect(progress.update(event({status: 'finished', downloaded: 900, total: 900, planned: 1000, parts: 2}))).toEqual(
      expect.objectContaining({downloaded: 900, total: 1000, speed: 0}),
    );
    const audio = progress.update(event({file: 'media.f140.m4a', downloaded: 20, total: 100, speed: 5, planned: 1000, parts: 2}));
    expect(audio).toEqual({downloaded: 920, total: 1000, speed: 5, eta: 16});
  });

  it('estimates fragment downloads from the fragment count', () => {
    const progress = new ProgressAggregator();
    expect(progress.update(event({downloaded: 300, fragment: 3, fragments: 10})).total).toBe(1000);
  });

  it('does not move backwards when a later size estimate grows', () => {
    const progress = new ProgressAggregator();
    progress.update(event({downloaded: 500, total: 1000}));
    const next = progress.update(event({downloaded: 510, total: 2000}));
    expect(next.downloaded).toBe(1000);
    expect(next.total).toBe(2000);
  });
});

describe('labels', () => {
  it('names post-processing steps', () => {
    expect(stageLabel('Merger')).toBe('Merging video and audio');
    expect(stageLabel('FFmpegExtractAudio')).toBe('Converting audio');
    expect(stageLabel('SomethingNewPP')).toBe('Processing');
    expect(stageLabel('MoveFiles')).toBeUndefined();
  });

  it('shortens yt-dlp errors', () => {
    expect(cleanYtdlError('ERROR: [youtube] abc123: Video unavailable. This video is private')).toBe('Video unavailable. This video is private');
    expect(cleanYtdlError('ERROR: Unable to download webpage; please report this issue on https://github.com/yt-dlp/yt-dlp/issues')).toBe('Unable to download webpage');
    expect(cleanYtdlError(undefined)).toBe('yt-dlp failed');
  });
});

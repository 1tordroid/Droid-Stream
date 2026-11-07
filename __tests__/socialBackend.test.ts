const mockRunFfmpeg = jest.fn();
const mockFetchFile = jest.fn(async () => undefined);

jest.mock('../src/lib/social/native', () => ({
  runFfmpeg: (...args: unknown[]) => mockRunFfmpeg(...args),
  fetchFile: (...args: unknown[]) => (mockFetchFile as (...values: unknown[]) => Promise<void>)(...args),
  mediaDuration: async () => 182,
  cancelFfmpeg: jest.fn(),
  cancelFetches: jest.fn(),
  onFfmpegProgress: () => () => undefined,
}));

jest.mock('../src/lib/downloadDestination', () => ({cleanupDownloadStaging: async () => undefined}));

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

import * as RNFS from '@dr.pogodin/react-native-fs';
import {beforeEach, describe, expect, it} from '@jest/globals';
import {socialDownloadBackend} from '../src/lib/social/backend';
import useDownloadsStore, {type DownloadItem} from '../src/lib/zustand/downloadsStore';

const record = (): DownloadItem => {
  useDownloadsStore.getState().addDownload({
    id: 'social-test',
    title: 'sample.user · Video with song',
    type: 'series',
    url: 'https://www.instagram.com/p/C3xYzAbCdEf/',
    sourceType: 'social',
    videoType: 'mp4',
    social: {
      images: [{url: 'https://cdn.test/a.jpg', ext: 'jpg'}, {url: 'https://cdn.test/b.jpg', ext: 'jpg'}],
      audioUrl: 'https://cdn.test/song.mp4',
      start: 45,
      duration: 15,
      secondsPerImage: 3,
      crossfade: true,
      width: 1080,
      height: 1350,
    },
  });
  return useDownloadsStore.getState().getDownload('social-test') as DownloadItem;
};

const destination = {stagingDirectory: '/cache/downloads/s', stagingPath: '/cache/downloads/s/out.mp4.part'};

describe('social download backend', () => {
  beforeEach(() => {
    mockRunFfmpeg.mockReset();
    mockFetchFile.mockClear();
    (RNFS.stat as jest.Mock).mockImplementation(async () => ({size: 1000}));
  });

  it('fetches the photos and the song, then makes the video with the clip the post uses', async () => {
    mockRunFfmpeg.mockImplementation(async () => ({code: 0, cancelled: false, log: ''}));
    await socialDownloadBackend.start({record: record(), destination});
    expect(mockFetchFile.mock.calls.map(call => (call as unknown[])[1])).toEqual([
      'https://cdn.test/a.jpg',
      'https://cdn.test/b.jpg',
      'https://cdn.test/song.mp4',
    ]);
    const args = mockRunFfmpeg.mock.calls[0][1] as string[];
    expect(args[args.indexOf('-ss') + 1]).toBe('45');
    expect(args[args.length - 1]).toBe(destination.stagingPath);
    expect(args).toContain('h264_mediacodec');
    expect(useDownloadsStore.getState().getDownload('social-test')?.social?.stage).toBeUndefined();
  });

  it('tries MPEG-4 when the phone refuses the H.264 encoder', async () => {
    mockRunFfmpeg
      .mockImplementationOnce(async () => ({code: 1, cancelled: false, log: 'Error initializing output stream'}))
      .mockImplementationOnce(async () => ({code: 0, cancelled: false, log: ''}));
    await socialDownloadBackend.start({record: record(), destination});
    expect(mockRunFfmpeg).toHaveBeenCalledTimes(2);
    expect(mockRunFfmpeg.mock.calls[1][1]).toContain('mpeg4');
  });

  it('reports the FFmpeg error when both encoders fail', async () => {
    mockRunFfmpeg.mockImplementation(async () => ({code: 1, cancelled: false, log: 'line one\nUnknown encoder'}));
    await expect(socialDownloadBackend.start({record: record(), destination})).rejects.toThrow('Could not make the video. Unknown encoder');
  });
});

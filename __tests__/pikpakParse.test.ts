// PikPak answers read into quota lines, transcoded copies, magnet previews and share links.
import {
  formatQuotaBytes,
  isImageEntry,
  parsePikPakQuota,
  parseResourceList,
  parseShareLink,
  parseWhatsLink,
  pikpakQualities,
  quotaLines,
  shareMessage,
  toPikPakEntry,
} from '../src/lib/pikpak/parse';

const TB = 1024 ** 4;

describe('PikPak quota', () => {
  it('reads storage, cloud transfer with an extra package, and daily plays', () => {
    const about = {kind: 'drive#about', quota: {kind: 'drive#quota', limit: String(10 * TB), usage: String(4 * TB), usage_in_trash: '1000', play_times_limit: '5', play_times_usage: '2'}};
    const transfer = {
      base: {info: 'Premium', offline: {total_assets: 40 * TB, assets: 0, size: 2 * TB}, download: {total_assets: 4 * TB, assets: 0, size: TB}},
      transfer: {offline: {info: 'extra', total_assets: 10 * TB, assets: TB}, download: {total_assets: 0, assets: 0}},
    };
    const quota = parsePikPakQuota(about, transfer);
    expect(quota.storage).toEqual({used: 4 * TB, limit: 10 * TB, trash: 1000, unlimited: false});
    expect(quota.cloudDownloads).toEqual({used: 3 * TB, limit: 50 * TB});
    expect(quota.downloads).toEqual({used: TB, limit: 4 * TB});
    expect(quota.playsToday).toEqual({used: 2, limit: 5});
    expect(quota.period).toBe('Premium');
    expect(quotaLines(quota)).toEqual([
      'Storage: 4.0 TB of 10 TB',
      'Cloud downloads: 3.0 TB of 50 TB',
      'Downloads to devices: 1.0 TB of 4.0 TB',
      'Plays today: 2 of 5',
    ]);
  });

  it('leaves out unlimited plays and a missing transfer answer', () => {
    const quota = parsePikPakQuota({quota: {limit: '0', usage: '512', play_times_limit: '-1', is_unlimited: true}});
    expect(quota.playsToday).toBeUndefined();
    expect(quota.cloudDownloads).toBeUndefined();
    expect(quotaLines(quota)).toEqual(['Storage: 512 B used, no limit']);
  });

  it('formats sizes', () => {
    expect(formatQuotaBytes(0)).toBe('0 B');
    expect(formatQuotaBytes(1536)).toBe('1.5 KB');
    expect(formatQuotaBytes(25 * 1024 ** 3)).toBe('25 GB');
  });
});

describe('PikPak transcodes', () => {
  it('lists transcodes from the highest resolution down, then the original', () => {
    const details = {
      web_content_link: 'https://dl.example/file.mkv',
      medias: [
        {media_name: '720P', link: {url: 'https://vod.example/720/index.m3u8'}, video: {height: 720, width: 1280}, is_origin: false},
        {media_name: 'Original', link: {url: 'https://dl.example/file.mkv'}, video: {height: 2160}, is_origin: true},
        {media_name: '1080P', link: {url: 'https://vod.example/1080/index.m3u8'}, video: {height: 1080}, is_origin: false, is_default: true},
        {media_name: 'empty', link: {}},
      ],
    };
    expect(pikpakQualities(details)).toEqual([
      {label: '1080P', url: 'https://vod.example/1080/index.m3u8', height: 1080, type: 'm3u8', original: false},
      {label: '720P', url: 'https://vod.example/720/index.m3u8', height: 720, type: 'm3u8', original: false},
      {label: 'Original', url: 'https://dl.example/file.mkv', height: 2160, type: 'mp4', original: true},
    ]);
  });

  it('falls back to the download link when PikPak has not transcoded the file', () => {
    expect(pikpakQualities({links: {'application/octet-stream': {url: 'https://dl.example/a.mp4'}}})).toEqual([
      {label: 'Original', url: 'https://dl.example/a.mp4', type: 'mp4', original: true},
    ]);
    expect(pikpakQualities({})).toEqual([]);
  });
});

describe('PikPak entries, previews and shares', () => {
  it('maps drive files and spots pictures', () => {
    const photo = toPikPakEntry({id: 'p', kind: 'drive#file', name: 'IMG_1.HEIC', size: '42', mime_type: 'image/heic', thumbnail_link: 'https://t', modified_time: '2024-01-02T00:00:00Z'});
    expect(photo).toMatchObject({id: 'p', folder: false, size: 42, thumbnail: 'https://t', modified: Date.parse('2024-01-02T00:00:00Z')});
    expect(isImageEntry(photo!)).toBe(true);
    expect(toPikPakEntry({id: 'd', kind: 'drive#folder', name: 'My Pack', folder_type: 'DOWNLOAD'})).toMatchObject({folder: true, downloads: true});
    expect(toPikPakEntry({kind: 'drive#file'})).toBeUndefined();
  });

  it('reads the file list of a magnet from PikPak, folders included', () => {
    const preview = parseResourceList({
      list: {
        resources: [
          {
            name: 'Show S01',
            file_size: '300',
            is_dir: true,
            dir: {resources: [{name: 'e1.mkv', file_size: '100'}, {name: 'Subs', is_dir: true, dir: {resources: [{name: 'e1.srt', file_size: '1'}]}}, {name: 'e2.mkv', file_size: '199'}]},
          },
        ],
      },
    });
    expect(preview).toEqual({
      name: 'Show S01',
      size: 300,
      count: 3,
      files: [
        {name: 'e1.mkv', path: '', size: 100},
        {name: 'e1.srt', path: 'Subs', size: 1},
        {name: 'e2.mkv', path: '', size: 199},
      ],
      screenshots: [],
      source: 'pikpak',
    });
    expect(parseResourceList({list: {resources: []}})).toBeUndefined();
  });

  it('reads whatslink totals and pictures, and its errors', () => {
    expect(parseWhatsLink({name: 'Movie', size: 2048, count: 3, screenshots: [{screenshot: 'https://s/1.jpg', time: 0}, 'https://s/2.jpg', {nope: 1}]})).toEqual({
      name: 'Movie',
      size: 2048,
      count: 3,
      files: [],
      screenshots: ['https://s/1.jpg', 'https://s/2.jpg'],
      source: 'whatslink',
    });
    expect(() => parseWhatsLink({error: 'not found'})).toThrow('not found');
  });

  it('reads share links with and without a code', () => {
    const link = parseShareLink({share_id: 's', share_url: 'https://mypikpak.com/s/abc', pass_code: '1234'});
    expect(link).toEqual({url: 'https://mypikpak.com/s/abc', passCode: '1234'});
    expect(shareMessage('Film', link)).toBe('Film\nhttps://mypikpak.com/s/abc\nCode: 1234');
    expect(parseShareLink({share_url: 'https://x', pass_code: ''})).toEqual({url: 'https://x'});
    expect(() => parseShareLink({})).toThrow();
  });
});

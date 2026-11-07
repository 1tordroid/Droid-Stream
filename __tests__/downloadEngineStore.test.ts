import {
  ftpPasswordFor,
  parseFtpUrl,
  pruneEngineOptions,
  getEngineOptions,
  scheduledStartDelay,
  setEngineOptions,
  storeFtpPassword,
} from '../src/lib/downloadEngine/engineStore';
import {withoutScheduledLater} from '../src/lib/downloadEngine/managerHelpers';
import type {DownloadItem} from '../src/lib/zustand/downloadsStore';

describe('FTP links', () => {
  it('reads scheme, user, port and path', () => {
    expect(parseFtpUrl('ftp://files.example.org/pub/a%20b.iso')).toEqual({
      scheme: 'ftp', user: 'anonymous', password: undefined, host: 'files.example.org', port: 21, path: '/pub/a b.iso',
    });
    expect(parseFtpUrl('ftps://me@secure.example:2990/x')).toMatchObject({scheme: 'ftps', user: 'me', port: 2990});
    expect(parseFtpUrl('ftps://me@secure.example/x')?.port).toBe(990);
    expect(parseFtpUrl('https://example.com')).toBeUndefined();
  });

  it('moves a password out of the link into the encrypted store', () => {
    const clean = storeFtpPassword('ftpes://alice:s%3Acret@nas.local/movies/film.mkv');
    expect(clean).toBe('ftpes://alice@nas.local/movies/film.mkv');
    expect(ftpPasswordFor(clean)).toBe('s:cret');
    expect(ftpPasswordFor('ftpes://bob@nas.local/movies/film.mkv')).toBeUndefined();
  });
});

describe('scheduled recordings', () => {
  const item = (id: string, sourceType: DownloadItem['sourceType'] = 'live') => ({id, sourceType}) as DownloadItem;

  afterEach(() => jest.useRealTimers());

  it('keeps recordings that start later out of the queue and wakes for the next one', () => {
    jest.useFakeTimers();
    const now = Date.now();
    setEngineOptions('later', {live: {startAt: now + 60_000}});
    setEngineOptions('now', {live: {startAt: now - 1}});
    expect(scheduledStartDelay('later', now)).toBe(60_000);
    const wake = jest.fn();
    const due = withoutScheduledLater([item('later'), item('now'), item('file', 'http')], wake);
    expect(due.map(entry => entry.id)).toEqual(['now', 'file']);
    jest.advanceTimersByTime(60_600);
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('drops options of removed downloads only when they are old', () => {
    setEngineOptions('gone', {dash: {video: 'v'}});
    pruneEngineOptions([]);
    expect(getEngineOptions('gone').dash).toEqual({video: 'v'});
    pruneEngineOptions([], Date.now() + 2 * 60 * 60_000);
    expect(getEngineOptions('gone')).toEqual({});
  });
});

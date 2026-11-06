jest.mock('../src/lib/sources/vault', () => ({readPikPakAccount: () => undefined}));
import {checkAllCaches, connectedServices, pickVideo, readDebridSettings, sendToDebrid, writeDebridSettings} from '../src/lib/debrid';
import {torbox} from '../src/lib/debrid/services';

const HASH = 'c'.repeat(40);
const json = (body: unknown) => ({ok: true, status: 200, text: async () => JSON.stringify(body)}) as any;

afterEach(() => jest.restoreAllMocks());

it('picks the largest real video, skipping samples', () => {
  expect(pickVideo([
    {id: '1', name: 'sample.mkv', size: 900},
    {id: '2', name: 'movie.mkv', size: 500},
    {id: '3', name: 'info.nfo', size: 9999},
  ])?.id).toBe('2');
});

it('lists only services with a key, preferred first', () => {
  writeDebridSettings({...readDebridSettings(), keys: {torbox: 'a', realdebrid: 'b'}, preferred: 'realdebrid'});
  expect(connectedServices().map(service => service.id)).toEqual(['realdebrid', 'torbox']);
});

it('marks cached hashes from TorBox', async () => {
  writeDebridSettings({...readDebridSettings(), keys: {torbox: 'key'}, checkCache: true});
  jest.spyOn(global, 'fetch' as any).mockResolvedValue(json({success: true, data: [{hash: HASH, name: 'x'}]}));
  expect(await checkAllCaches([HASH, 'd'.repeat(40)])).toEqual({[HASH]: ['torbox']});
});

it('adds a magnet and waits until the service is ready', async () => {
  writeDebridSettings({...readDebridSettings(), keys: {torbox: 'key'}});
  const fetchMock = jest.spyOn(global, 'fetch' as any)
    .mockResolvedValueOnce(json({success: true, data: {torrent_id: 7}}))
    .mockResolvedValueOnce(json({success: true, data: {id: 7, name: 'Movie', progress: 1, download_finished: true, download_present: true, files: [{id: 0, short_name: 'Movie.mkv', size: 10}]}}))
    .mockResolvedValueOnce(json({success: true, data: 'https://cdn.torbox.test/file'}));
  const resolution = await sendToDebrid('torbox', `magnet:?xt=urn:btih:${HASH}`);
  expect(resolution.files[0].name).toBe('Movie.mkv');
  expect(await torbox.fileLink('key', resolution.transfer, resolution.files[0])).toBe('https://cdn.torbox.test/file');
  expect(String(fetchMock.mock.calls[2][0])).toContain('torrent_id=7&file_id=0');
});

import {
  addPlaylist,
  getJioServer,
  isFavourite,
  isStale,
  jioEpgUrl,
  jioPlaylistUrl,
  listFavourites,
  listPlaylists,
  listRecent,
  listSources,
  loadPlaylist,
  normalizeServer,
  PLAYLIST_MAX_AGE_MS,
  pushRecent,
  readCachedPlaylist,
  removePlaylist,
  setJioServer,
  toggleFavourite,
} from '../src/lib/livetv/store';

const M3U = '#EXTM3U\n#EXTINF:-1 tvg-id="a",A\nhttp://x/a.m3u8\n';
const ok = (text: string) => ({ok: true, status: 200, text: async () => text}) as any;

describe('live TV store', () => {
  it('normalizes JioTV Go addresses', () => {
    expect(normalizeServer('192.168.1.5')).toBe('http://192.168.1.5:5001');
    expect(normalizeServer('192.168.1.5:8080/')).toBe('http://192.168.1.5:8080');
    expect(normalizeServer('HTTP://localhost')).toBe('http://localhost:5001');
    expect(normalizeServer('https://tv.example.com')).toBe('https://tv.example.com');
    expect(normalizeServer('http://[::1]:5001')).toBe('http://[::1]:5001');
    expect(normalizeServer('  ')).toBe('');
  });

  it('saves the JioTV Go server and builds its playlist and EPG paths', () => {
    expect(getJioServer()).toBeUndefined();
    const saved = setJioServer('10.0.0.2', 'high')!;
    expect(getJioServer()).toEqual({address: 'http://10.0.0.2:5001', quality: 'high'});
    expect(jioPlaylistUrl(saved)).toBe('http://10.0.0.2:5001/playlist.m3u?q=high');
    expect(jioPlaylistUrl({...saved, quality: 'auto'})).toBe('http://10.0.0.2:5001/playlist.m3u');
    expect(jioEpgUrl(saved)).toBe('http://10.0.0.2:5001/epg.xml.gz');
    expect(listSources().map(s => s.id)).toEqual(['iptv-org', 'jiotv']);
    setJioServer('');
    expect(getJioServer()).toBeUndefined();
  });

  it('adds, dedupes and removes playlists', () => {
    expect(() => addPlaylist('x', 'ftp://nope')).toThrow();
    const first = addPlaylist('', 'https://lists.example/tv.m3u');
    expect(first.name).toBe('lists.example');
    expect(addPlaylist('Again', 'https://lists.example/tv.m3u').id).toBe(first.id);
    expect(listPlaylists()).toHaveLength(1);
    expect(listSources().some(s => s.id === first.id)).toBe(true);
    removePlaylist(first.id);
    expect(listPlaylists()).toEqual([]);
  });

  it('caches playlists and falls back to the cache when offline', async () => {
    const source = listSources()[0];
    const fetcher = jest.fn().mockResolvedValue(ok(M3U));
    const first = await loadPlaylist(source, {fetcher});
    expect(first.playlist.channels[0].name).toBe('A');
    await loadPlaylist(source, {fetcher});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(isStale(readCachedPlaylist(source))).toBe(false);
    expect(isStale(first, first.fetchedAt + PLAYLIST_MAX_AGE_MS + 1)).toBe(true);
    const offline = jest.fn().mockRejectedValue(new Error('offline'));
    expect((await loadPlaylist(source, {force: true, fetcher: offline})).playlist.channels).toHaveLength(1);
  });

  it('explains an unreachable JioTV Go server', async () => {
    setJioServer('10.0.0.9');
    const source = listSources().find(s => s.kind === 'jiotv')!;
    await expect(loadPlaylist(source, {fetcher: jest.fn().mockRejectedValue(new Error('x'))})).rejects.toThrow(/jiotv_go is running/);
    await expect(loadPlaylist(source, {fetcher: jest.fn().mockResolvedValue(ok('<html/>'))})).rejects.toThrow(/No channels/);
    setJioServer('');
  });

  it('toggles favourites and keeps recent channels newest first', () => {
    const a = {id: 'a', name: 'A', url: 'http://x/a', attrs: {}};
    const b = {id: 'b', name: 'B', url: 'http://x/b', attrs: {}};
    expect(toggleFavourite(a, 'iptv-org')).toBe(true);
    expect(isFavourite('iptv-org', 'a')).toBe(true);
    expect(isFavourite('other', 'a')).toBe(false);
    expect(listFavourites()[0]).toMatchObject({id: 'a', sourceId: 'iptv-org'});
    expect(toggleFavourite(a, 'iptv-org')).toBe(false);
    expect(listFavourites()).toEqual([]);
    pushRecent(a, 's');
    pushRecent(b, 's');
    pushRecent(a, 's');
    expect(listRecent().map(c => c.id)).toEqual(['a', 'b']);
    for (let i = 0; i < 30; i++) pushRecent({...a, id: `c${i}`}, 's');
    expect(listRecent()).toHaveLength(20);
  });
});

// PikPak, debrid services and Tordroid Plus as poster library sources: which
// show up, how their folders list, how scans group them into titles, and how
// their files play (PikPak and Tordroid Plus with every transcode).
const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});

const PP = 'https://api-drive.mypikpak.com/drive/v1';

const pikpakDrive: Record<string, unknown> = {
  '': {files: [{id: 'pack', kind: 'drive#folder', name: 'My Pack', folder_type: 'DOWNLOAD'}, {id: 'img', kind: 'drive#file', name: 'cover.jpg', size: '10', mime_type: 'image/jpeg'}]},
  pack: {files: [{id: 'movie', kind: 'drive#file', name: 'Inception.2010.1080p.mkv', size: '900', modified_time: '2024-05-01T00:00:00Z'}, {id: 'show', kind: 'drive#folder', name: 'Dark'}]},
  show: {files: [{id: 'e1', kind: 'drive#file', name: 'Dark.S01E01.mkv', size: '50'}, {id: 'e2', kind: 'drive#file', name: 'Dark.S01E02.mkv', size: '51'}]},
};

describe('cloud library sources', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  const load = () => ({
    vault: require('../src/lib/sources/vault'),
    debrid: require('../src/lib/debrid'),
    cloud: require('../src/lib/netlib/cloud'),
    resolve: require('../src/lib/netlib/resolve'),
    ids: require('../src/lib/netlib/ids'),
    walk: require('../src/lib/netlib/scan/walk'),
    group: require('../src/lib/netlib/group'),
  });

  it('lists only signed-in accounts, after your own sources', () => {
    const {vault, debrid, resolve} = load();
    vault.saveSource({id: 'w', kind: 'webdav', name: 'DAV', server: 'https://dav.local', username: 'me', secret: 'pw'});
    expect(resolve.listNetlibSources().map((source: any) => source.id)).toEqual(['w']);
    vault.savePikPakAccount({username: 'me', accessToken: 'pp'});
    debrid.writeDebridSettings({...debrid.readDebridSettings(), keys: {torbox: 'tb', offcloud: 'oc'}, preferred: 'offcloud'});
    vault.saveTordroidPlusAccount({server: 'https://plus.example', email: 'e', password: 'p', token: 't'});
    expect(resolve.listNetlibSources().map((source: any) => [source.id, source.kind, source.name])).toEqual([
      ['w', 'webdav', 'DAV'],
      ['cloud:pikpak', 'pikpak', 'PikPak'],
      ['cloud:debrid:torbox', 'debrid', 'TorBox'],
      ['cloud:tdplus', 'tdplus', 'Tordroid Plus'],
    ]);
    // A Tordroid Plus sign-in that ended drops out until the user signs in again.
    vault.saveTordroidPlusAccount({server: 'https://plus.example', email: 'e', password: '', token: '', signedOut: true});
    expect(resolve.listNetlibSources().map((source: any) => source.id)).not.toContain('cloud:tdplus');
  });

  it('scans the PikPak drive into movies and shows, and plays every transcode', async () => {
    const {vault, cloud, resolve, ids, walk, group} = load();
    vault.savePikPakAccount({username: 'me', accessToken: 'pp'});
    fetchMock.mockImplementation((url: string, init: any) => {
      expect(init.headers.Authorization).toBe('Bearer pp');
      const parent = /parent_id=([^&]*)/.exec(url)?.[1];
      if (parent !== undefined) return json(200, pikpakDrive[decodeURIComponent(parent)] || {files: []});
      if (url.startsWith(`${PP}/files/movie`)) {
        return json(200, {
          id: 'movie',
          web_content_link: 'https://dl/movie.mkv',
          medias: [
            {media_name: '480P', link: {url: 'https://vod/480.m3u8'}, video: {height: 480}},
            {media_name: '1080P', link: {url: 'https://vod/1080.m3u8'}, video: {height: 1080}},
          ],
        });
      }
      return json(404, {error: 'not found'});
    });
    const source = resolve.findNetlibSource('cloud:pikpak');
    const top = await cloud.cloudLister(source)('');
    expect(top).toEqual([
      {path: 'pack', name: 'My Pack', directory: true},
      {path: 'img', name: 'cover.jpg', directory: false, size: 10, mimeType: 'image/jpeg'},
    ]);
    expect(cloud.isCloudEntryImage(top[1])).toBe(true);

    const {files} = await walk.walkVideos('', cloud.cloudLister(source));
    const items = group.groupNetlib('cloud:pikpak', files);
    expect(items.map((item: any) => [item.kind, item.title, item.year])).toEqual([
      ['movie', 'Inception', 2010],
      ['show', 'Dark', undefined],
    ]);
    expect(items[1].episodes.map((episode: any) => episode.episode)).toEqual([1, 2]);

    const key = ids.versionKey('cloud:pikpak', 'movie');
    expect(items[0].versions[0].key).toBe(key);
    expect(resolve.netlibHasQualities(key)).toBe(true);
    expect(await resolve.resolveNetlibStreams(key)).toEqual([
      {url: 'https://vod/1080.m3u8', type: 'm3u8', label: 'PikPak 1080P'},
      {url: 'https://vod/480.m3u8', type: 'm3u8', label: 'PikPak 480P'},
      {url: 'https://dl/movie.mkv', type: 'mp4', label: 'PikPak Original'},
    ]);
    expect(await resolve.resolveNetlibStream(key)).toEqual({url: 'https://vod/1080.m3u8', type: 'm3u8', label: 'PikPak 1080P'});
  });

  it('shows debrid transfers as folders and plays a file through its link', async () => {
    const {debrid, cloud, resolve, ids, walk, group} = load();
    debrid.writeDebridSettings({...debrid.readDebridSettings(), keys: {torbox: 'tb'}});
    const transfer = {id: 11, name: 'Arrival (2016)', download_finished: true, download_present: true, files: [{id: 3, short_name: 'Arrival.2016.2160p.mkv', size: 4000}, {id: 4, short_name: 'readme.txt', size: 1}]};
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/torrents/mylist?bypass_cache')) return json(200, {data: [transfer, {id: 12, name: 'Half done', download_finished: false, files: []}]});
      if (url.includes('/torrents/mylist?id=11')) return json(200, {data: transfer});
      if (url.includes('/torrents/requestdl')) return json(200, {data: 'https://cdn.torbox/arrival.mkv'});
      return json(404, {});
    });
    const source = resolve.findNetlibSource('cloud:debrid:torbox');
    const lister = cloud.cloudLister(source);
    expect(await lister('')).toEqual([{path: 't:11', name: 'Arrival (2016)', directory: true}]);
    const {files} = await walk.walkVideos('', lister);
    expect(files).toEqual([{path: 'f:11/3', name: 'Arrival.2016.2160p.mkv', folders: ['Arrival (2016)'], size: 4000}]);
    const [item] = group.groupNetlib('cloud:debrid:torbox', files);
    expect(item).toMatchObject({kind: 'movie', title: 'Arrival', year: 2016});
    const key = ids.versionKey('cloud:debrid:torbox', 'f:11/3');
    expect(resolve.netlibHasQualities(key)).toBe(false);
    expect(await resolve.resolveNetlibStreams(key)).toEqual([{url: 'https://cdn.torbox/arrival.mkv', type: 'mkv', label: 'TorBox'}]);
    expect(cloud.parseDebridPath('f:a%2Fb/c')).toEqual({transferId: 'a/b', fileId: 'c'});
  });

  it('shows finished Tordroid Plus downloads as folders and plays their streams', async () => {
    const {vault, cloud, resolve, ids, walk, group} = load();
    vault.saveTordroidPlusAccount({server: 'https://plus.example', email: 'e', password: 'p', token: 't'});
    const row = (id: number, name: string, fileId: string, phase: string) => ({id, created_at: '2026-10-01T00:00:00Z', data: {url: 'm', task: {task: {name, file_id: fileId, phase, progress: 100}}}});
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/tasks')) {
        return json(200, {data: [row(1, 'The Matrix (1999)', 'MX', 'PHASE_TYPE_COMPLETE'), row(2, 'Pending', 'PD', 'PHASE_TYPE_RUNNING'), row(3, 'The Matrix again', 'MX', 'PHASE_TYPE_COMPLETE')], count: 3});
      }
      if (url.endsWith('/api/media/MX')) return json(200, {type: 'folder', id: 'MX', name: 'The Matrix (1999)', videos: [{id: 'mx1', name: 'The.Matrix.1999.mkv', path: '', size: 7}]});
      if (url.endsWith('/api/media/mx1')) {
        return json(200, {type: 'file', id: 'mx1', name: 'The.Matrix.1999.mkv', is_video: true, streams: [{label: '720P', url: 'https://vod/720.m3u8', height: 720}, {label: 'Original file', url: 'https://dl/mx.mkv', is_origin: true}]});
      }
      return json(404, {});
    });
    const source = resolve.findNetlibSource('cloud:tdplus');
    const lister = cloud.cloudLister(source);
    expect(await lister('')).toEqual([{path: 'd:MX', name: 'The Matrix (1999)', directory: true, modified: Date.parse('2026-10-01T00:00:00Z')}]);
    const {files} = await walk.walkVideos('', lister);
    const [item] = group.groupNetlib('cloud:tdplus', files);
    expect(item).toMatchObject({kind: 'movie', title: 'The Matrix', year: 1999});
    const key = ids.versionKey('cloud:tdplus', 'mx1');
    expect(await resolve.resolveNetlibStreams(key)).toEqual([
      {url: 'https://vod/720.m3u8', type: 'm3u8', label: 'Tordroid Plus 720P'},
      {url: 'https://dl/mx.mkv', type: 'mp4', label: 'Tordroid Plus Original'},
    ]);
  });

  it('makes a playable item for a single cloud file', () => {
    const {cloud, ids} = load();
    const item = cloud.looseCloudItem('cloud:pikpak', 'F9', 'Clip.mp4');
    expect(item).toMatchObject({sourceId: 'cloud:pikpak', kind: 'other', title: 'Clip.mp4', versions: [{key: ids.versionKey('cloud:pikpak', 'F9'), name: 'Clip.mp4'}]});
  });
});

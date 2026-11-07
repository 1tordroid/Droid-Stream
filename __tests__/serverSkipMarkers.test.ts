// Emby and Plex skip markers: parsing their answers, finding the item behind a
// stream address, and fetching with the saved sign-in.
import {embyItemIdOf, OPEN_END_SECONDS, parseEmbyChapters, parsePlexMarkers} from '../src/lib/playback/skipSegmentModel';
import {
  fetchSegments,
  findEmbyItem,
  findPlexItem,
  gatherSegments,
  mediaServerItemKey,
  NO_FETCHED_SEGMENTS,
} from '../src/lib/playback/skipSources';
import {listPlex, resolvePlexPlayUrl} from '../src/lib/sources/mediaServers';
import {plexItemForPart, plexPartPath, rememberPlexPart} from '../src/lib/sources/plexParts';
import type {SavedSource} from '../src/lib/sources/vault';
import {cacheStorage, mainStorage} from '../src/lib/storage/StorageService';

let mockSources: SavedSource[] = [];
jest.mock('../src/lib/sources/vault', () => ({listSources: () => mockSources}));
jest.mock('../src/lib/aniskip', () => ({findAnimeSkips: jest.fn(async () => [])}));

const TICKS = 1e7;
const emby = {id: 'e1', kind: 'emby', name: 'Emby', server: 'http://emby.local:8096/', username: 'user-1', secret: 'tok', deviceId: 'dev-e'} as SavedSource;
const plex = {id: 'p1', kind: 'plex', name: 'Plex', server: 'http://plex.local:32400', username: 'me', secret: 'ptok'} as SavedSource;

const answer = (body: unknown) => ({ok: true, status: 200, json: async () => body}) as unknown as Response;

beforeEach(() => {
  mockSources = [];
  mainStorage.clearAll();
  cacheStorage.clearAll();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Emby markers', () => {
  it('reads IntroStart, IntroEnd and CreditsStart markers', () => {
    const segments = parseEmbyChapters({
      RunTimeTicks: 1400 * TICKS,
      Chapters: [
        {StartPositionTicks: 0, Name: 'Chapter 1', MarkerType: 'Chapter'},
        {StartPositionTicks: 5 * TICKS, MarkerType: 'IntroStart'},
        {StartPositionTicks: 75 * TICKS, MarkerType: 'IntroEnd'},
        {StartPositionTicks: 1320 * TICKS, MarkerType: 'CreditsStart'},
      ],
    });
    expect(segments.map(s => [s.kind, s.from, s.to, s.source])).toEqual([
      ['intro', 5, 75, 'emby'],
      ['credits', 1320, 1400, 'emby'],
    ]);
  });

  it('starts the intro at 0 without IntroStart and leaves credits open without a runtime', () => {
    const segments = parseEmbyChapters({
      Chapters: [
        {StartPositionTicks: 60 * TICKS, MarkerType: 'IntroEnd'},
        {StartPositionTicks: 1300 * TICKS, MarkerType: 'CreditsStart'},
      ],
    });
    expect(segments.map(s => [s.kind, s.from, s.to])).toEqual([
      ['intro', 0, 60],
      ['credits', 1300, 1300 + OPEN_END_SECONDS],
    ]);
  });

  it('falls back to chapters named Intro and Credits', () => {
    const segments = parseEmbyChapters({
      RunTimeTicks: 1500 * TICKS,
      Chapters: [
        {StartPositionTicks: 0, Name: 'Cold open', MarkerType: 'Chapter'},
        {StartPositionTicks: 120 * TICKS, Name: 'Intro', MarkerType: 'Chapter'},
        {StartPositionTicks: 200 * TICKS, Name: 'Part 1', MarkerType: 'Chapter'},
        {StartPositionTicks: 1400 * TICKS, Name: 'Credits', MarkerType: 'Chapter'},
      ],
    });
    expect(segments.map(s => [s.kind, s.from, s.to])).toEqual([
      ['intro', 120, 200],
      ['credits', 1400, 1500],
    ]);
  });

  it('gives nothing for broken answers', () => {
    expect(parseEmbyChapters({})).toEqual([]);
    expect(parseEmbyChapters(null)).toEqual([]);
    expect(parseEmbyChapters({Chapters: [{StartPositionTicks: 0, MarkerType: 'IntroEnd'}]})).toEqual([]);
  });

  it('finds the Emby item behind a stream address', () => {
    expect(embyItemIdOf('http://emby.local:8096/Videos/12345/stream?static=true&api_key=tok')).toBe('12345');
    expect(embyItemIdOf('http://emby.local:8096/video.mkv')).toBeUndefined();
    const url = 'http://emby.local:8096/Videos/12345/stream?static=true&api_key=tok';
    expect(findEmbyItem([undefined, url], [emby])).toEqual({source: emby, itemId: '12345'});
    expect(findEmbyItem([url], [{...emby, authState: 'signedOut'}])).toBeUndefined();
    expect(findEmbyItem([url], [{...emby, kind: 'jellyfin'} as SavedSource])).toBeUndefined();
  });

  it('fetches the chapters with the saved sign-in', async () => {
    mockSources = [emby];
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      answer({RunTimeTicks: 1400 * TICKS, Chapters: [{StartPositionTicks: 70 * TICKS, MarkerType: 'IntroEnd'}]}),
    );
    const found = await fetchSegments({streamUrls: ['http://emby.local:8096/Videos/777/stream?static=true&api_key=tok']});
    expect(found.emby.map(s => [s.kind, s.from, s.to])).toEqual([['intro', 0, 70]]);
    expect(found.jellyfin).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://emby.local:8096/Users/user-1/Items/777?Fields=Chapters');
    expect((init.headers as Record<string, string>).Authorization).toContain('Token="tok"');
    expect((init.headers as Record<string, string>).Authorization).toContain('DeviceId="dev-e"');
  });
});

describe('Plex markers', () => {
  it('reads intro and credits markers in milliseconds', () => {
    const segments = parsePlexMarkers({
      MediaContainer: {
        Metadata: [
          {
            Marker: [
              {type: 'intro', startTimeOffset: 12000, endTimeOffset: 80500},
              {type: 'credits', startTimeOffset: 1310000, endTimeOffset: 1400000, final: true},
              {type: 'commercial', startTimeOffset: 1, endTimeOffset: 2},
              {type: 'credits', startTimeOffset: 1350000, endTimeOffset: 1360000},
            ],
          },
        ],
      },
    });
    expect(segments.map(s => [s.kind, s.from, s.to, s.source])).toEqual([
      ['intro', 12, 80.5, 'plex'],
      ['credits', 1310, 1400, 'plex'],
    ]);
    expect(parsePlexMarkers({MediaContainer: {Metadata: [{}]}})).toEqual([]);
    expect(parsePlexMarkers(undefined)).toEqual([]);
  });

  it('remembers which item a media part plays', () => {
    const part = 'http://plex.local:32400/library/parts/55/1690000000/file.mkv?X-Plex-Token=ptok';
    expect(plexPartPath('http://plex.local:32400/', part)).toBe('/library/parts/55/1690000000/file.mkv');
    expect(plexPartPath('http://other:32400', part)).toBeUndefined();
    expect(plexPartPath('http://plex.local:32400', 'http://plex.local:32400/library/metadata/9')).toBeUndefined();
    expect(plexItemForPart(plex.server, part)).toBeUndefined();
    rememberPlexPart(plex.server, part, '9001');
    expect(plexItemForPart(plex.server, 'http://plex.local:32400/library/parts/55/1690000000/file.mkv')).toBe('9001');
    expect(findPlexItem([part], [plex])).toEqual({source: plex, ratingKey: '9001'});
    expect(findPlexItem([part], [{...plex, authState: 'signedOut'}])).toBeUndefined();
  });

  it('learns the pair from the Plex library listing and from opening a video', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      answer({MediaContainer: {Metadata: [{ratingKey: '301', title: 'Ep 1', type: 'episode', Media: [{Part: [{key: '/library/parts/88/5/file.mkv'}]}]}]}}),
    );
    const [item] = await listPlex(plex.server, 'ptok', '/library/metadata/300/children');
    expect(plexItemForPart(plex.server, item.playUrl)).toBe('301');
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      answer({MediaContainer: {Metadata: [{ratingKey: '302', title: 'Ep 2', type: 'episode', Media: [{Part: [{key: '/library/parts/89/5/file.mkv'}]}]}]}}),
    );
    const url = await resolvePlexPlayUrl(plex.server, 'ptok', '302');
    expect(plexItemForPart(plex.server, url)).toBe('302');
  });

  it('fetches the markers with the Plex token', async () => {
    mockSources = [plex];
    const part = 'http://plex.local:32400/library/parts/56/1/file.mkv?X-Plex-Token=ptok';
    rememberPlexPart(plex.server, part, '42');
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      answer({MediaContainer: {Metadata: [{Marker: [{type: 'intro', startTimeOffset: 0, endTimeOffset: 60000}]}]}}),
    );
    const found = await fetchSegments({streamUrls: [part]});
    expect(found.plex.map(s => [s.kind, s.from, s.to])).toEqual([['intro', 0, 60]]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://plex.local:32400/library/metadata/42?includeMarkers=1');
    expect((init.headers as Record<string, string>)['X-Plex-Token']).toBe('ptok');
  });

  it('asks nothing for a part the library never handed out', async () => {
    mockSources = [plex];
    const fetchMock = jest.spyOn(global, 'fetch');
    const found = await fetchSegments({streamUrls: ['http://plex.local:32400/library/parts/99/1/file.mkv']});
    expect(found.plex).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('merging and keys', () => {
  it('puts server markers after the provider and before the viewer marks', () => {
    const merged = gatherSegments({
      provider: [],
      fetched: {
        ...NO_FETCHED_SEGMENTS,
        plex: parsePlexMarkers({MediaContainer: {Metadata: [{Marker: [{type: 'intro', startTimeOffset: 0, endTimeOffset: 50000}]}]}}),
      },
      marks: {introEnd: 90},
      durationSeconds: 1400,
    });
    expect(merged.map(s => [s.kind, s.source, s.to])).toEqual([['intro', 'plex', 50]]);
  });

  it('names the server item behind the stream', () => {
    const embyUrl = 'http://emby.local:8096/Videos/12/stream?static=true';
    expect(mediaServerItemKey([embyUrl], [emby])).toBe('emby:e1:12');
    const part = 'http://plex.local:32400/library/parts/7/1/file.mkv';
    rememberPlexPart(plex.server, part, '70');
    expect(mediaServerItemKey([part], [plex])).toBe('plex:p1:70');
    expect(mediaServerItemKey(['https://example.com/a.mkv'], [emby, plex])).toBeUndefined();
  });
});

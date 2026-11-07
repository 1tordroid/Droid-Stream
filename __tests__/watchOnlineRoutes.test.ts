// Watch online: cached debrid first, then PikPak, then the torrent on this
// device; debrid services without the torrent cached are only a choice.
import {nextRoute, planWatchRoutes, routeKey, routeLabel} from '../src/lib/watchOnline/routes';

const services = [
  {id: 'torbox' as const, name: 'TorBox', canCheckCache: true},
  {id: 'realdebrid' as const, name: 'Real-Debrid', canCheckCache: true},
  {id: 'pikpak' as const, name: 'PikPak', canCheckCache: false},
];

describe('Watch online routes', () => {
  it('puts cached debrid first, then PikPak, then the torrent', () => {
    const plan = planWatchRoutes({services, cachedOn: ['realdebrid'], pikpak: true, hasMagnet: true, canStream: true});
    expect(plan.auto.map(routeKey)).toEqual(['debrid:realdebrid', 'pikpak', 'torrent']);
    expect(plan.others.map(routeKey)).toEqual(['debrid:torbox']);
    expect(routeLabel(plan.auto[0])).toBe('Real-Debrid (cached)');
    expect(routeLabel(plan.others[0])).toBe('TorBox');
  });

  it('keeps the preferred order between cached services', () => {
    const plan = planWatchRoutes({services, cachedOn: ['torbox', 'realdebrid'], pikpak: false, hasMagnet: true, canStream: true});
    expect(plan.auto.map(routeKey)).toEqual(['debrid:torbox', 'debrid:realdebrid', 'torrent']);
    expect(plan.others).toEqual([]);
  });

  it('streams a .torrent link without a magnet only on the device', () => {
    const plan = planWatchRoutes({services, cachedOn: [], pikpak: true, hasMagnet: false, canStream: true});
    expect(plan.auto.map(routeKey)).toEqual(['torrent']);
    expect(plan.others).toEqual([]);
  });

  it('has nothing to try without any way in', () => {
    expect(planWatchRoutes({services: [], cachedOn: [], pikpak: false, hasMagnet: false, canStream: false})).toEqual({auto: [], others: []});
  });

  it('falls back along the automatic order only', () => {
    const plan = planWatchRoutes({services, cachedOn: ['torbox'], pikpak: true, hasMagnet: true, canStream: true});
    expect(routeKey(nextRoute(plan, plan.auto[0])!)).toBe('pikpak');
    expect(routeKey(nextRoute(plan, plan.auto[1])!)).toBe('torrent');
    expect(nextRoute(plan, plan.auto[2])).toBeUndefined();
    // A hand-picked uncached service has no automatic next step.
    expect(nextRoute(plan, plan.others[0])).toBeUndefined();
  });
});

describe('Watch online plan for a result', () => {
  beforeEach(() => {
    jest.resetModules();
    // The player and torrent actions are not needed to plan the routes.
    jest.doMock('../src/lib/torrentSearch/actions', () => ({playDebridFile: jest.fn(), streamOnDevice: jest.fn()}));
    jest.doMock('../src/lib/netlib/playback', () => ({playNetlibVersion: jest.fn()}));
  });

  it('checks caches when the caller has none and sees the PikPak sign-in', async () => {
    const checkAllCaches = jest.fn(async () => ({abc: ['torbox']}));
    jest.doMock('../src/lib/debrid', () => ({
      ...jest.requireActual('../src/lib/debrid'),
      connectedServices: () => [
        {id: 'torbox', name: 'TorBox', canCheckCache: true},
        {id: 'pikpak', name: 'PikPak', canCheckCache: false},
      ],
      checkAllCaches,
    }));
    jest.doMock('../src/lib/pikpak/drive', () => ({isPikPakSignedIn: () => true}));
    const {buildWatchPlan} = require('../src/lib/watchOnline/run');
    const result = {id: 'abc', title: 'Film', infoHash: 'abc', magnet: 'magnet:?xt=urn:btih:abc', sizeBytes: 0, seeders: 0, leechers: 0, uploadedAt: 0, category: 'movies', engine: 'x', engines: ['x']};
    const plan = await buildWatchPlan(result);
    expect(checkAllCaches).toHaveBeenCalledWith(['abc']);
    expect(plan.auto.map(routeKey)).toEqual(['debrid:torbox', 'pikpak', 'torrent']);
    // Results that already ran a cache check are not checked again.
    checkAllCaches.mockClear();
    const known = await buildWatchPlan(result, []);
    expect(checkAllCaches).not.toHaveBeenCalled();
    expect(known.auto.map(routeKey)).toEqual(['pikpak', 'torrent']);
    expect(known.others.map(routeKey)).toEqual(['debrid:torbox']);
  });

  it('turns PikPak phase names into plain words', () => {
    jest.doMock('../src/lib/pikpak/drive', () => ({isPikPakSignedIn: () => false}));
    const {statusText} = require('../src/lib/watchOnline/run');
    expect(statusText('PHASE_TYPE_RUNNING')).toBe('downloading');
    expect(statusText('queued_UP')).toBe('queued up');
  });
});

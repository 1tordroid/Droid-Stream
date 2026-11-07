import {
  catalogCacheKey,
  catalogFilters,
  catalogPath,
  CATALOG_TTL_MS,
  itemsForProfile,
  listAddonCatalogs,
  loadCatalogRow,
  parseManifestCatalogs,
  toRowItems,
  validExtra,
} from '../src/lib/addonRows/catalogs';
import {
  addRow,
  defaultRowTitle,
  MAX_ADDON_ROWS,
  moveRow,
  parseRows,
  readRows,
  removeRow,
  renameRow,
  rowsForHome,
  rowTitle,
  setRowHidden,
  useAddonRowsStore,
  writeRows,
  type AddonRow,
} from '../src/lib/addonRows/rows';
import {mainStorage} from '../src/lib/storage/StorageService';
import type {InstalledAddon, StremioManifest} from '../src/lib/stremio';

const addon = (base: string, manifest: Partial<StremioManifest>, enabled = true): InstalledAddon => ({
  base,
  enabled,
  addedAt: 0,
  manifest: {id: base, name: base, types: ['movie', 'series'], resources: ['catalog'], ...manifest},
});

const CINEMETA = addon('https://cinemeta', {
  name: 'Cinemeta',
  catalogs: [
    {type: 'movie', id: 'top', name: 'Popular', extra: [{name: 'genre', options: ['Action', 'Comedy']}, {name: 'search'}, {name: 'skip'}]},
    {type: 'series', id: 'top', name: 'Popular', extra: [{name: 'genre', options: ['Drama']}]},
    {type: 'movie', id: 'year', name: 'New', extra: [{name: 'genre', options: ['2025', '2024'], isRequired: true}]},
    {type: 'movie', id: 'search-only', name: 'Search', extra: [{name: 'search', isRequired: true}]},
    {type: 'channel', id: 'tv', name: 'Channels'},
    {type: 'movie', id: 'needs-text', extra: [{name: 'lastVideosIds', isRequired: true}]},
  ],
});
const ADULT = addon('https://adult', {name: 'Night', behaviorHints: {adult: true}, catalogs: [{type: 'movie', id: 'all', name: 'All'}]});

describe('catalogs from manifests', () => {
  it('keeps movie and series catalogs that can be rows', () => {
    const catalogs = parseManifestCatalogs(CINEMETA);
    expect(catalogs.map(catalog => `${catalog.type}/${catalog.id}`)).toEqual(['movie/top', 'series/top', 'movie/year']);
    expect(catalogs[0]).toMatchObject({addonName: 'Cinemeta', name: 'Popular', adult: false, filters: [{name: 'genre', options: ['Action', 'Comedy'], required: false}]});
    expect(catalogs[2].filters).toEqual([{name: 'genre', options: ['2025', '2024'], required: true}]);
  });

  it('reads the older manifest form', () => {
    expect(catalogFilters({type: 'movie', id: 'x', extraSupported: ['genre', 'skip'], genres: ['Horror', 'Horror', 'Sci-Fi']})).toEqual([
      {name: 'genre', options: ['Horror', 'Sci-Fi'], required: false},
    ]);
    expect(catalogFilters({type: 'movie', id: 'x', extraRequired: ['search']})).toBeUndefined();
  });

  it('survives broken manifests', () => {
    expect(parseManifestCatalogs(addon('https://broken', {catalogs: [null as any, {type: 'movie'} as any, {type: 'movie', id: 'ok', extra: 'x' as any}]}))).toEqual([
      expect.objectContaining({id: 'ok', name: 'ok', filters: []}),
    ]);
    expect(parseManifestCatalogs({base: 'x', enabled: true, addedAt: 0} as any)).toEqual([]);
  });

  it('skips turned-off add-ons, and adult add-ons on a kids profile', () => {
    const off = addon('https://off', {catalogs: [{type: 'movie', id: 'a'}]}, false);
    expect(listAddonCatalogs([CINEMETA, ADULT, off]).map(catalog => catalog.addonBase)).toEqual(['https://cinemeta', 'https://cinemeta', 'https://cinemeta', 'https://adult']);
    expect(listAddonCatalogs([CINEMETA, ADULT, off], {kids: true}).every(catalog => catalog.addonBase === 'https://cinemeta')).toBe(true);
  });

  it('checks the chosen filters', () => {
    const [top, , year] = parseManifestCatalogs(CINEMETA);
    expect(validExtra(top, {})).toBe(true);
    expect(validExtra(top, {genre: 'Action'})).toBe(true);
    expect(validExtra(top, {genre: 'Western'})).toBe(false);
    expect(validExtra(top, {year: '2020'})).toBe(false);
    expect(validExtra(year, {})).toBe(false);
  });

  it('builds catalog paths with filters', () => {
    expect(catalogPath('movie', 'top')).toBe('/catalog/movie/top.json');
    expect(catalogPath('movie', 'top', {genre: 'Sci-Fi & Fantasy'})).toBe('/catalog/movie/top/genre=Sci-Fi%20%26%20Fantasy.json');
    expect(catalogCacheKey('https://a', 'movie', 'top')).not.toBe(catalogCacheKey('https://b', 'movie', 'top'));
  });
});

describe('row items', () => {
  const metas = [
    {id: 'tt1', type: 'movie', name: 'One', poster: 'p1', releaseInfo: '2001'},
    {id: 'tt1', type: 'movie', name: 'One again', poster: 'p1'},
    {id: 'tmdb:55', type: 'movie', name: 'Two', poster: 'p2'},
    {id: 'kitsu:3', type: 'series', name: 'Three', poster: 'p3', imdb_id: 'tt3'},
    {id: 'x', type: 'movie', name: 'No poster'},
    {id: 'tt9', type: 'movie', name: 'Late night', poster: 'p9', genres: ['Erotic']},
  ];

  it('keeps titles with posters, once each, and their ids', () => {
    const items = toRowItems(metas, 'movie');
    expect(items.map(item => item.id)).toEqual(['tt1', 'tmdb:55', 'kitsu:3', 'tt9']);
    expect(items[0]).toEqual({id: 'tt1', type: 'movie', name: 'One', poster: 'p1', year: 2001, imdbId: 'tt1'});
    expect(items[1].tmdbId).toBe('55');
    expect(items[2]).toMatchObject({type: 'series', imdbId: 'tt3'});
  });

  it('limits the row', () => {
    expect(toRowItems(metas, 'movie', 2)).toHaveLength(2);
    expect(toRowItems(undefined, 'movie')).toEqual([]);
  });

  it('hides adult titles on a kids profile only', () => {
    const items = toRowItems(metas, 'movie');
    expect(itemsForProfile(items, false)).toHaveLength(4);
    expect(itemsForProfile(items, true).map(item => item.id)).toEqual(['tt1', 'tmdb:55', 'kitsu:3']);
  });

  it('loads a row once and answers from the cache for 6 hours', async () => {
    const values = new Map<string, string>();
    const store = {getString: (key: string) => values.get(key), setString: (key: string, value: string) => {
      values.set(key, value);
    }};
    const fetchJson = jest.fn(async () => ({metas}));
    const row = {addonBase: 'https://cinemeta', type: 'movie' as const, catalogId: 'top', extra: {genre: 'Action'}};
    const now = 1_800_000_000_000;
    await loadCatalogRow(row, {store, now, fetchJson});
    expect(fetchJson).toHaveBeenCalledWith('https://cinemeta/catalog/movie/top/genre=Action.json', undefined);
    await loadCatalogRow(row, {store, now: now + CATALOG_TTL_MS - 1, fetchJson});
    expect(fetchJson).toHaveBeenCalledTimes(1);
    // Stale, and the add-on is down: the old titles are used.
    const failing = jest.fn(async () => { throw new Error('offline'); });
    const old = await loadCatalogRow(row, {store, now: now + CATALOG_TTL_MS + 1, fetchJson: failing});
    expect(old).toHaveLength(4);
    await expect(loadCatalogRow({...row, catalogId: 'other'}, {store, now, fetchJson: failing})).rejects.toThrow('offline');
  });
});

describe('row editor', () => {
  const [top, series, year] = parseManifestCatalogs(CINEMETA);
  let counter = 0;
  const id = () => `r${++counter}`;
  beforeEach(() => {
    counter = 0;
  });

  it('adds rows at the end, once each', () => {
    let rows: AddonRow[] = [];
    rows = addRow(rows, top, {}, id).rows;
    rows = addRow(rows, top, {genre: 'Action'}, id).rows;
    rows = addRow(rows, series, {}, id).rows;
    expect(rows.map(row => row.id)).toEqual(['r1', 'r2', 'r3']);
    expect(rows[1]).toMatchObject({catalogId: 'top', extra: {genre: 'Action'}});
    const again = addRow(rows, top, {genre: 'Action'}, id);
    expect(again.reason).toBe('exists');
    expect(again.rows).toBe(rows);
  });

  it('shows a hidden row again instead of adding it twice', () => {
    const rows = setRowHidden(addRow([], top, {}, id).rows, 'r1', true);
    const result = addRow(rows, top, {}, id);
    expect(result.reason).toBe('exists');
    expect(result.rows).toEqual([expect.not.objectContaining({hidden: true})]);
  });

  it('needs required filters and caps the number of rows', () => {
    expect(addRow([], year, {}, id).reason).toBe('filters');
    expect(addRow([], year, {genre: '2025'}, id).added).toBeDefined();
    const full = Array.from({length: MAX_ADDON_ROWS}, (_, index) => ({...addRow([], top, {}, id).added!, id: `f${index}`, catalogId: `c${index}`}));
    expect(addRow(full, top, {}, id).reason).toBe('full');
  });

  it('moves, renames, hides and removes rows', () => {
    let rows = [top, series].reduce<AddonRow[]>((list, catalog) => addRow(list, catalog, {}, id).rows, []);
    rows = moveRow(rows, 'r2', -1);
    expect(rows.map(row => row.id)).toEqual(['r2', 'r1']);
    expect(moveRow(rows, 'r2', -1)).toBe(rows);
    expect(moveRow(rows, 'r1', 1)).toBe(rows);
    rows = renameRow(rows, 'r1', '  Weekend picks  ');
    expect(rowTitle(rows[1])).toBe('Weekend picks');
    rows = renameRow(rows, 'r1', '');
    expect(rows[1].name).toBeUndefined();
    expect(rowTitle(rows[1])).toBe('Popular movies');
    rows = setRowHidden(rows, 'r2', true);
    expect(rows[0].hidden).toBe(true);
    rows = removeRow(rows, 'r2');
    expect(rows.map(row => row.id)).toEqual(['r1']);
  });

  it('names rows after the catalog and filters', () => {
    expect(defaultRowTitle({catalogName: 'Popular', type: 'series', extra: {genre: 'Drama'}})).toBe('Popular shows · Drama');
    expect(defaultRowTitle({catalogName: 'Top Movies', type: 'movie'})).toBe('Top Movies');
  });

  it('shows on Home only rows whose add-on is installed, on, and allowed', () => {
    let rows: AddonRow[] = [];
    rows = addRow(rows, top, {}, id).rows;
    rows = addRow(rows, parseManifestCatalogs(ADDON_OFF_LATER)[0], {}, id).rows;
    rows = addRow(rows, parseManifestCatalogs(ADULT)[0], {}, id).rows;
    rows = addRow(rows, top, {genre: 'Comedy'}, id).rows;
    rows = setRowHidden(rows, 'r4', true);
    const installed = [CINEMETA, {...ADDON_OFF_LATER, enabled: false}, ADULT];
    expect(rowsForHome(rows, installed).map(row => row.id)).toEqual(['r1', 'r3']);
    expect(rowsForHome(rows, installed, {kids: true}).map(row => row.id)).toEqual(['r1']);
    expect(rowsForHome(rows, [ADULT]).map(row => row.id)).toEqual(['r3']);
  });

  it('hides rows with an adult filter on a kids profile', () => {
    const catalog = parseManifestCatalogs(addon('https://g', {catalogs: [{type: 'movie', id: 'g', name: 'By genre', extra: [{name: 'genre', options: ['Family', 'Erotic']}]}]}))[0];
    const rows = addRow(addRow([], catalog, {genre: 'Family'}, id).rows, catalog, {genre: 'Erotic'}, id).rows;
    const installed = [addon('https://g', {})];
    expect(rowsForHome(rows, installed, {kids: true}).map(row => row.extra?.genre)).toEqual(['Family']);
  });
});

const ADDON_OFF_LATER = addon('https://later', {name: 'Later', catalogs: [{type: 'movie', id: 'm', name: 'Movies'}]});

describe('rows per profile', () => {
  it('keeps each profile its own rows', () => {
    const [top] = parseManifestCatalogs(CINEMETA);
    const mine = addRow([], top, {}, () => 'a').rows;
    const kids = addRow([], top, {genre: 'Comedy'}, () => 'b').rows;
    writeRows(mine, 'default');
    writeRows(kids, 'kid1');
    expect(readRows('default')).toEqual(mine);
    expect(readRows('kid1')).toEqual(kids);
    expect(mainStorage.getString('p.kid1.homeAddonRows')).toBe(JSON.stringify(kids));
    // The profile in use (default in tests) updates Home at once.
    expect(useAddonRowsStore.getState().rows).toEqual(mine);
  });

  it('drops broken saved rows', () => {
    expect(parseRows('not json')).toEqual([]);
    expect(parseRows(JSON.stringify([{id: 'a'}, {id: 'b', addonBase: 'x', catalogId: 'c', type: 'movie', catalogName: 'C'}]))).toHaveLength(1);
  });
});

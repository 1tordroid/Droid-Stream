import * as RNFS from '@dr.pogodin/react-native-fs';
import {browserJson, readSettings} from '../store';
import {compileCosmetic, emptyCosmetic, selectorsFor, type CompiledCosmetic} from './cosmetic';
import {FilterEngine} from './engine';
import {compileNetwork, emptyParsed, parseFilterLine, type ParsedFilters} from './parse';
import {clearNativeFilters, loadNativeFilters, setNativeBlocking} from '../native';

/**
 * Filter lists: downloaded by the app when first needed and again every
 * week, never bundled. They are compiled once into rule lines for the
 * native request hook and element-hiding data for the page script.
 */

export interface FilterList {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  builtIn?: boolean;
  updatedAt?: number;
  rules?: number;
  error?: string;
}

export const BUILT_IN_LISTS: FilterList[] = [
  {id: 'easylist', name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt', enabled: true, builtIn: true},
  {id: 'easyprivacy', name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt', enabled: true, builtIn: true},
  {id: 'indianlist', name: 'IndianList', url: 'https://easylist-downloads.adblockplus.org/indianlist.txt', enabled: true, builtIn: true},
];

const WEEK = 7 * 24 * 60 * 60 * 1000;
/** Raised when the compiled format changes, so old compiled files are rebuilt. */
const COMPILER_VERSION = 1;

const DIR = `${RNFS.DocumentDirectoryPath}/browser/filters`;
const listPath = (id: string) => `${DIR}/${id}.txt`;

export const readLists = (): FilterList[] => {
  const saved = browserJson.read<FilterList[]>('filterLists', []);
  const out: FilterList[] = BUILT_IN_LISTS.map(list => ({...list, ...saved.find(item => item.id === list.id), builtIn: true, url: list.url}));
  for (const item of saved) if (!item.builtIn && !BUILT_IN_LISTS.some(list => list.id === item.id)) out.push(item);
  return out;
};

export const saveLists = (lists: FilterList[]): void => browserJson.write('filterLists', lists);

export const addList = (url: string, name?: string): FilterList[] => {
  const clean = url.trim();
  if (!/^https:\/\/\S+$/i.test(clean)) throw new Error('Use an https:// link to a filter list');
  const lists = readLists();
  if (lists.some(item => item.url === clean)) return lists;
  const next = [...lists, {id: `list${Date.now().toString(36)}`, name: name?.trim() || clean.replace(/^https:\/\//, '').slice(0, 60), url: clean, enabled: true}];
  saveLists(next);
  return next;
};

export const removeList = (id: string): FilterList[] => {
  const next = readLists().filter(item => item.id !== id || item.builtIn);
  saveLists(next);
  RNFS.unlink(listPath(id)).catch(() => undefined);
  return next;
};

export const setListEnabled = (id: string, enabled: boolean): FilterList[] => {
  const next = readLists().map(item => (item.id === id ? {...item, enabled} : item));
  saveLists(next);
  return next;
};

const hash = (text: string): string => {
  let value = 5381;
  for (let index = 0; index < text.length; index += 1) value = ((value << 5) + value + text.charCodeAt(index)) | 0;
  return (value >>> 0).toString(36);
};

const signature = (lists: FilterList[], customRules: string): string =>
  hash(JSON.stringify([COMPILER_VERSION, lists.filter(item => item.enabled).map(item => [item.id, item.updatedAt || 0]), customRules]));

const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Parses a large list a few thousand lines at a time, so the app stays responsive. */
const parseInChunks = async (text: string, out: ParsedFilters): Promise<void> => {
  let start = 0;
  let count = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    parseFilterLine(text.slice(start, end), out);
    start = end + 1;
    count += 1;
    if (count % 4000 === 0) await pause();
  }
};

const downloadList = async (list: FilterList): Promise<FilterList> => {
  try {
    const response = await fetch(list.url, {headers: {Accept: 'text/plain,*/*'}});
    if (!response.ok) throw new Error(`The list server answered ${response.status}`);
    const text = await response.text();
    if (text.length < 20 || /^\s*</.test(text)) throw new Error('This link is not a filter list');
    await RNFS.mkdir(DIR).catch(() => undefined);
    await RNFS.writeFile(listPath(list.id), text, 'utf8');
    return {...list, updatedAt: Date.now(), error: undefined};
  } catch (error) {
    return {...list, error: error instanceof Error ? error.message : String(error)};
  }
};

interface CompiledState {
  signature: string;
  networkPath: string;
  cosmetic: CompiledCosmetic;
  pageRules: FilterEngine;
}

let compiled: CompiledState | null = null;
let running: Promise<void> | null = null;

const compile = async (lists: FilterList[], customRules: string, sig: string): Promise<void> => {
  const parsed = emptyParsed();
  const counts: Record<string, number> = {};
  for (const list of lists.filter(item => item.enabled)) {
    const text = await RNFS.readFile(listPath(list.id), 'utf8').catch(() => '');
    const before = parsed.network.length + parsed.cosmetic.length;
    await parseInChunks(text, parsed);
    counts[list.id] = parsed.network.length + parsed.cosmetic.length - before;
  }
  await parseInChunks(customRules, parsed);
  await pause();
  const lines = compileNetwork(parsed);
  await pause();
  const cosmetic = compileCosmetic(parsed.cosmetic);
  const pageLines = lines.filter(line => /^e\t/.test(line) && /[dghs]/.test(line.split('\t')[9] || ''));
  const networkPath = `${DIR}/compiled-${sig}.txt`;
  await RNFS.mkdir(DIR).catch(() => undefined);
  await RNFS.writeFile(networkPath, lines.join('\n'), 'utf8');
  await RNFS.writeFile(`${DIR}/cosmetic.json`, JSON.stringify({signature: sig, networkPath, cosmetic, pageLines}), 'utf8');
  for (const item of await RNFS.readDir(DIR).catch(() => [])) {
    if (/^compiled-.*\.txt$/.test(item.name) && item.path !== networkPath) RNFS.unlink(item.path).catch(() => undefined);
  }
  saveLists(readLists().map(item => (counts[item.id] !== undefined ? {...item, rules: counts[item.id]} : item)));
  compiled = {signature: sig, networkPath, cosmetic, pageRules: FilterEngine.fromLines(pageLines)};
};

const loadCompiled = async (sig: string): Promise<boolean> => {
  if (compiled?.signature === sig) return true;
  try {
    const raw = await RNFS.readFile(`${DIR}/cosmetic.json`, 'utf8');
    const data = JSON.parse(raw) as {signature: string; networkPath: string; cosmetic: CompiledCosmetic; pageLines: string[]};
    if (data.signature !== sig || !(await RNFS.exists(data.networkPath))) return false;
    compiled = {signature: sig, networkPath: data.networkPath, cosmetic: data.cosmetic || emptyCosmetic(), pageRules: FilterEngine.fromLines(data.pageLines || [])};
    return true;
  } catch {
    return false;
  }
};

/**
 * Makes sure the blocker is ready: downloads missing or week-old lists,
 * compiles them when anything changed, and loads the rules into the native
 * hook. Safe to call often; work only happens when something changed.
 */
export const ensureFilters = async (options: {force?: boolean; onProgress?: (text: string) => void} = {}): Promise<void> => {
  if (running) return running;
  running = (async () => {
    const settings = readSettings();
    setNativeBlocking(settings.blockAds, settings.allowedSites);
    if (!settings.blockAds) return;
    let lists = readLists();
    const now = Date.now();
    const stale = lists.filter(item => item.enabled && (options.force || !item.updatedAt || now - item.updatedAt > WEEK));
    for (const list of stale) {
      options.onProgress?.(`Downloading ${list.name}…`);
      const updated = await downloadList(list);
      lists = lists.map(item => (item.id === list.id ? (updated.error && item.updatedAt ? {...item, error: updated.error} : updated) : item));
      saveLists(lists);
    }
    const sig = signature(lists, settings.customRules);
    if (!(await loadCompiled(sig))) {
      options.onProgress?.('Preparing the blocker…');
      await compile(lists, settings.customRules, sig);
    }
    if (compiled) await loadNativeFilters(compiled.networkPath);
  })().finally(() => {
    running = null;
  });
  return running;
};

/** After the user changed lists or rules: rebuild now. */
export const rebuildFilters = async (force = false): Promise<void> => {
  compiled = null;
  clearNativeFilters();
  await ensureFilters({force});
};

/** Selectors to hide on a page, or none while the lists are not ready. */
export const hidingSelectorsFor = (url: string): string[] => {
  const settings = readSettings();
  if (!settings.blockAds || !compiled) return [];
  const host = /^https?:\/\/(?:[^@/?#]*@)?([^:/?#]+)/i.exec(url)?.[1]?.toLowerCase() || '';
  if (!host || settings.allowedSites.some(site => host === site || host.endsWith(`.${site}`))) return [];
  return selectorsFor(compiled.cosmetic, host, compiled.pageRules.pageFlags(url));
};

export const filtersReady = (): boolean => Boolean(compiled);

export const LIST_CREDITS = 'EasyList and EasyPrivacy by the EasyList authors (easylist.to), IndianList by its maintainers; GPL-3.0 or CC BY-SA 3.0. Downloaded by the app, not shipped with it.';

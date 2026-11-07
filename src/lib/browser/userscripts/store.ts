import {validateProviderUrl} from '../../sandbox/urlGuard';
import {browserJson} from '../store';
import {parseUserscript, type UserscriptMeta} from './meta';

/**
 * Installed userscripts and their GM_setValue data, in the browser's MMKV
 * store. Scripts are shared by every profile.
 */

export interface Userscript {
  id: string;
  meta: UserscriptMeta;
  /** The script with its @require files in front. */
  code: string;
  enabled: boolean;
  installedAt: number;
  sourceUrl?: string;
}

const MAX_CODE = 2 * 1024 * 1024;
const MAX_VALUES = 512 * 1024;

const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());

export const onUserscriptsChange = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const readUserscripts = (): Userscript[] => browserJson.read<Userscript[]>('userscripts', []);

const save = (list: Userscript[]) => {
  browserJson.write('userscripts', list);
  changed();
};

const fetchText = async (url: string): Promise<string> => {
  const checked = validateProviderUrl(url);
  const response = await fetch(checked.toString());
  if (!response.ok) throw new Error(`The server answered ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_CODE) throw new Error('The script is too large');
  return text;
};

/** Installs or updates a script (same @name and @namespace replace the old one). */
export const installUserscript = async (source: string, sourceUrl?: string): Promise<Userscript> => {
  const meta = parseUserscript(source);
  if (!meta) throw new Error('No ==UserScript== block with a @name was found');
  const required: string[] = [];
  for (const url of meta.require.slice(0, 8)) {
    if (!/^https:\/\//i.test(url)) throw new Error(`@require must use https: ${url}`);
    required.push(`/* @require ${url} */\n${await fetchText(url)}`);
  }
  const code = [...required, source].join('\n;\n');
  if (code.length > MAX_CODE) throw new Error('The script is too large');
  const list = readUserscripts();
  const existing = list.find(item => item.meta.name === meta.name && item.meta.namespace === meta.namespace);
  const script: Userscript = {
    id: existing?.id || `us${Date.now().toString(36)}`,
    meta,
    code,
    enabled: existing?.enabled ?? true,
    installedAt: Date.now(),
    sourceUrl: sourceUrl || existing?.sourceUrl,
  };
  save([script, ...list.filter(item => item.id !== script.id)]);
  return script;
};

export const installUserscriptFromUrl = async (url: string): Promise<Userscript> => installUserscript(await fetchText(url), url);

export const setUserscriptEnabled = (id: string, enabled: boolean): void =>
  save(readUserscripts().map(item => (item.id === id ? {...item, enabled} : item)));

export const removeUserscript = (id: string): void => {
  save(readUserscripts().filter(item => item.id !== id));
  browserJson.write(`gm.${id}`, {});
};

// --- GM_setValue and friends ---

export const readValues = (id: string): Record<string, unknown> => browserJson.read<Record<string, unknown>>(`gm.${id}`, {});

export const writeValue = (id: string, key: string, value: unknown): void => {
  if (!readUserscripts().some(item => item.id === id)) return;
  const values = {...readValues(id), [key]: value};
  if (JSON.stringify(values).length > MAX_VALUES) return;
  browserJson.write(`gm.${id}`, values);
};

export const deleteValue = (id: string, key: string): void => {
  const values = {...readValues(id)};
  delete values[key];
  browserJson.write(`gm.${id}`, values);
};

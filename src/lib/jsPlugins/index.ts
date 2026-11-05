import {MMKVLoader} from 'react-native-mmkv-storage';
import {sandboxBridge} from '../sandbox/sandboxBridge';
import {MAX_MODULE_SIZE} from '../sandbox/protocol';
import {normalizeRepoUrl, parseRepoManifest, validStreams, wrapPluginCode, type ScriptPluginEntry, type ScriptPluginStream} from './format';

export type {ScriptPluginStream} from './format';

const storage = new MMKVLoader().withInstanceID('droid-stream-script-plugins').initialize();
const INDEX_KEY = 'plugins';
const codeKey = (repoUrl: string, id: string) => `code:${repoUrl}:${id}`;

export interface ScriptPlugin extends ScriptPluginEntry {
  repoUrl: string;
  enabled: boolean;
}

export const readPlugins = (): ScriptPlugin[] => {
  try {
    return JSON.parse(storage.getString(INDEX_KEY) || '[]');
  } catch {
    return [];
  }
};

const writePlugins = (plugins: ScriptPlugin[]): void => {
  storage.setString(INDEX_KEY, JSON.stringify(plugins));
};

/** Downloads every plugin a repository lists. New plugins start switched off. */
export const installRepo = async (input: string): Promise<ScriptPlugin[]> => {
  const repoUrl = normalizeRepoUrl(input);
  const response = await fetch(repoUrl);
  if (!response.ok) throw new Error(`Could not read that manifest (HTTP ${response.status})`);
  const entries = parseRepoManifest(await response.json(), repoUrl);
  const current = readPlugins();
  const added: ScriptPlugin[] = [];
  for (const entry of entries) {
    try {
      const file = await fetch(entry.url);
      if (!file.ok) continue;
      const code = await file.text();
      if (code.length > MAX_MODULE_SIZE) continue;
      storage.setString(codeKey(repoUrl, entry.id), code);
      const previous = current.find(item => item.repoUrl === repoUrl && item.id === entry.id);
      added.push({...entry, repoUrl, enabled: previous?.enabled ?? false});
    } catch {
      // One missing file does not stop the rest of the repository.
    }
  }
  if (!added.length) throw new Error('None of the plugins in this repository could be downloaded');
  writePlugins([...current.filter(item => item.repoUrl !== repoUrl), ...added]);
  return added;
};

export const removeRepo = (repoUrl: string): void => {
  const plugins = readPlugins();
  plugins.filter(item => item.repoUrl === repoUrl).forEach(item => storage.removeItem(codeKey(repoUrl, item.id)));
  writePlugins(plugins.filter(item => item.repoUrl !== repoUrl));
};

export const setPluginEnabled = (plugin: ScriptPlugin, enabled: boolean): void => {
  writePlugins(readPlugins().map(item => (item.repoUrl === plugin.repoUrl && item.id === plugin.id ? {...item, enabled} : item)));
};

export interface PluginRequest {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
}

/** Runs one plugin inside the same sandbox as Vega providers. */
export const runPlugin = async (plugin: ScriptPlugin, request: PluginRequest, signal?: AbortSignal): Promise<ScriptPluginStream[]> => {
  const code = storage.getString(codeKey(plugin.repoUrl, plugin.id));
  if (!code) throw new Error('This plugin is missing. Refresh its repository');
  const result = await sandboxBridge.invoke<unknown>({
    moduleCode: wrapPluginCode(code),
    providerValue: plugin.id,
    author: `script-plugin:${plugin.repoUrl}`,
    exportName: 'runPlugin',
    args: {...request},
    state: {},
    signal,
  });
  return validStreams(result);
};

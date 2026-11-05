/**
 * Script plugins: a repository publishes a manifest.json that lists JavaScript
 * files, and each file exports getStreams(tmdbId, mediaType, season, episode).
 * Nuvio uses this format. This is original code written from the public format
 * description, so no code from those projects is included.
 */

export interface ScriptPluginEntry {
  id: string;
  name: string;
  version?: string;
  description?: string;
  /** Absolute URL of the script. */
  url: string;
  types: ('movie' | 'tv')[];
}

export interface ScriptPluginStream {
  name?: string;
  title?: string;
  url?: string;
  quality?: string;
  size?: string;
  headers?: Record<string, string>;
}

export const normalizeRepoUrl = (input: string): string => {
  const url = input.trim();
  if (!/^https:\/\//i.test(url)) throw new Error('Use an https:// link to a manifest.json file');
  return url;
};

/** Manifests are a plain list, or an object holding the list. */
export const parseRepoManifest = (data: unknown, repoUrl: string): ScriptPluginEntry[] => {
  const source: any = data;
  const list: any[] = Array.isArray(source) ? source : source?.scrapers || source?.providers || source?.plugins || [];
  if (!Array.isArray(list) || !list.length) throw new Error('This manifest lists no plugins');
  const entries: ScriptPluginEntry[] = [];
  for (const item of list) {
    if (!item?.id || !item?.filename) continue;
    const url = new URL(String(item.filename), repoUrl).toString();
    if (!/^https:\/\//i.test(url)) continue;
    const types = (Array.isArray(item.supportedTypes) ? item.supportedTypes : ['movie', 'tv'])
      .map((type: string) => (type === 'series' ? 'tv' : type))
      .filter((type: string) => type === 'movie' || type === 'tv');
    entries.push({
      id: String(item.id),
      name: String(item.name || item.id),
      version: item.version ? String(item.version) : undefined,
      description: item.description ? String(item.description) : undefined,
      url,
      types,
    });
  }
  if (!entries.length) throw new Error('This manifest lists no usable plugins');
  return entries;
};

/**
 * Wraps a script for the provider sandbox. The script runs when the export is
 * called, because the sandbox hands over cheerio and axios only at that point.
 */
export const wrapPluginCode = (code: string): string => `
exports.runPlugin = function (input) {
  var context = input.providerContext;
  var require = function (name) {
    if (/cheerio/.test(name)) return context.cheerio;
    if (name === 'axios') return context.axios;
    return {};
  };
  var module = {exports: {}};
  var exports = module.exports;
  var global = providerGlobal;
  var run = (function () {
    ${code}
    ;return typeof getStreams === 'function' ? getStreams : undefined;
  })();
  var getStreams = module.exports.getStreams || (module.exports.default && module.exports.default.getStreams) || run;
  if (typeof getStreams !== 'function') throw new Error('This plugin has no getStreams function');
  return getStreams(input.tmdbId, input.mediaType, input.season, input.episode);
};
`;

export const validStreams = (value: unknown): ScriptPluginStream[] =>
  (Array.isArray(value) ? value : []).filter(
    (stream: any) => typeof stream?.url === 'string' && /^(https?:\/\/|magnet:)/i.test(stream.url),
  );

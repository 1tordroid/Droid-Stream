import {normalizeRepoUrl, parseRepoManifest, validStreams, wrapPluginCode} from '../src/lib/jsPlugins/format';

const REPO = 'https://example.test/repo/manifest.json';

const runWrapped = (code: string, input: Record<string, unknown>) => {
  const exports: Record<string, any> = {};
  new Function('exports', 'providerGlobal', `"use strict";\n${wrapPluginCode(code)}`)(exports, {});
  return exports.runPlugin({providerContext: {cheerio: {marker: 'cheerio'}, axios: {}}, ...input});
};

describe('script plugin repositories', () => {
  it('accepts only https manifests', () => {
    expect(normalizeRepoUrl(` ${REPO} `)).toBe(REPO);
    expect(() => normalizeRepoUrl('http://example.test/manifest.json')).toThrow('https');
  });

  it('reads a plain list and resolves script paths', () => {
    const [entry] = parseRepoManifest([{id: 'one', name: 'One', filename: 'providers/one.js', supportedTypes: ['movie', 'series']}], REPO);
    expect(entry.url).toBe('https://example.test/repo/providers/one.js');
    expect(entry.types).toEqual(['movie', 'tv']);
  });

  it('reads an object manifest and rejects empty ones', () => {
    expect(parseRepoManifest({scrapers: [{id: 'two', filename: 'two.js'}]}, REPO)[0].name).toBe('two');
    expect(() => parseRepoManifest({scrapers: []}, REPO)).toThrow('no plugins');
    expect(() => parseRepoManifest([{id: 'three', filename: 'http://insecure.test/x.js'}], REPO)).toThrow('no usable');
  });
});

describe('script plugin wrapper', () => {
  it('calls module.exports.getStreams with the title details', async () => {
    const code = 'function getStreams(id, type, s, e) { return Promise.resolve([{url: "https://a.test/" + id + type + s + e}]); } module.exports = {getStreams};';
    await expect(runWrapped(code, {tmdbId: 603, mediaType: 'tv', season: 1, episode: 2})).resolves.toEqual([{url: 'https://a.test/603tv12'}]);
  });

  it('supports a plain top-level getStreams and gives plugins cheerio', () => {
    const code = 'var c = require("cheerio-without-node-native"); function getStreams() { return c.marker; }';
    expect(runWrapped(code, {})).toBe('cheerio');
  });

  it('explains a plugin without getStreams', () => {
    expect(() => runWrapped('var nothing = 1;', {})).toThrow('no getStreams');
  });

  it('keeps only streams with a playable link', () => {
    expect(validStreams([{url: 'https://a.test/x'}, {url: 'magnet:?xt=1'}, {url: 'javascript:alert(1)'}, {title: 'none'}])).toHaveLength(2);
    expect(validStreams('nope')).toEqual([]);
  });
});

// Credits and licences: every entry links somewhere (or says it has none), names are
// unique, required wording is kept, and the old Open-source licences route still works.
import fs from 'fs';
import path from 'path';
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {FlatList, Linking, Text} from 'react-native';

let mockIsTV = false;
jest.mock('../src/lib/tv', () => ({
  get isTV() {
    return mockIsTV;
  },
}));
jest.mock('../src/components/ui/Text', () => require('react-native').Text);
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/components/tv', () => {
  const ReactActual = require('react');
  const {Pressable, View} = require('react-native');
  return {
    TVFocusGuide: ({children}: any) => ReactActual.createElement(View, null, children),
    TVFocusable: ReactActual.forwardRef(({children, ...props}: any, ref: any) =>
      ReactActual.createElement(Pressable, {...props, ref, focusable: true}, typeof children === 'function' ? children({focused: false}) : children),
    ),
  };
});
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('../src/lib/tv/focus', () => ({getNodeHandle: () => 1, requestTVFocusByHandle: jest.fn()}));
jest.mock('expo-application', () => ({nativeApplicationVersion: '5.6.0', nativeBuildVersion: '222'}));
jest.mock('expo-constants', () => ({__esModule: true, default: {expoConfig: {extra: {appEdition: 'main'}}}}));

import {ALL_SECTIONS, CREDIT_SECTIONS, LICENSE_SECTION, VEGA_REQUIRED_NOTICE} from '../src/screens/settings/creditsData';
import CreditsAndLicences, {buildCreditRows} from '../src/screens/settings/CreditsAndLicences';
import Credits from '../src/screens/settings/Credits';
import {TMDB_LOGO_PATH, TMDB_LOGO_XML} from '../src/screens/settings/tmdbLogo';
import OpenSourceLicenses from '../src/screens/settings/OpenSourceLicenses';

const textOf = (node: renderer.ReactTestInstance): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');
const lines = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(textOf);

const allEntries = ALL_SECTIONS.flatMap(section => section.items.map(entry => ({section: section.id, entry})));
const findEntry = (name: string) => allEntries.find(item => item.entry.name === name)?.entry;

let mounted: renderer.ReactTestRenderer[] = [];
afterEach(() => {
  mounted.forEach(tree => act(() => tree.unmount()));
  mounted = [];
  mockIsTV = false;
  jest.restoreAllMocks();
});

const render = (element: React.ReactElement) => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(element);
  });
  mounted.push(tree);
  return tree;
};

describe('credits data', () => {
  it('gives every entry at least one link, or marks it as having none', () => {
    for (const {entry} of allEntries) {
      if (entry.noLinks) {
        expect(entry.links).toEqual([]);
      } else {
        expect(entry.links.length).toBeGreaterThan(0);
      }
      for (const link of entry.links) {
        expect(link.label).toBeTruthy();
        expect(link.url).toMatch(/^https:\/\/[^\s]+$/);
      }
      expect(new Set(entry.links.map(link => link.url)).size).toBe(entry.links.length);
    }
  });

  it('has no duplicate names in the credits or in the licence list', () => {
    const creditNames = CREDIT_SECTIONS.flatMap(section => section.items.map(entry => entry.name));
    expect(new Set(creditNames).size).toBe(creditNames.length);
    const licenceNames = LICENSE_SECTION.items.map(entry => entry.name);
    expect(new Set(licenceNames).size).toBe(licenceNames.length);
    const sectionIds = ALL_SECTIONS.map(section => section.id);
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
  });

  it('gives every licence entry a licence', () => {
    for (const entry of LICENSE_SECTION.items) {
      expect(entry.license).toBeTruthy();
    }
  });

  it('keeps the Vega credit, the Required Notice and the required service wording', () => {
    expect(findEntry('Vega by vega-org')?.note).toBe('The original app, its layout, and the provider system.');
    const licence = fs.readFileSync(path.join(__dirname, '..', 'LICENSE'), 'utf8');
    const notices = licence.split(/\r?\n/).filter(line => line.startsWith('Required Notice:'));
    expect(notices).toEqual([VEGA_REQUIRED_NOTICE]);
    expect(findEntry('Vega')?.notice).toBe(VEGA_REQUIRED_NOTICE);
    expect(findEntry('TMDB (The Movie Database)')?.notice).toBe(
      'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    );
    expect(findEntry('TMDB (The Movie Database)')?.logo).toBe('tmdb');
    for (const name of ['JioTV Go by the jiotv-go project', 'jiotv_go by the jiotv-go project']) {
      expect(findEntry(name)?.note).toContain('Not affiliated with Jio.');
    }
    expect(findEntry('JioTV Go by the jiotv-go project')?.note).toContain('Licensed CC BY 4.0.');
    const ideas = CREDIT_SECTIONS.find(section => section.id === 'ideas');
    expect(ideas?.intro).toContain('Droid Stream uses none of their code');
  });

  it('lists the Droid Stream links and the projects named for this page', () => {
    const urls = (name: string) => findEntry(name)?.links.map(link => link.url) ?? [];
    expect(urls('Droid Stream')).toContain('https://github.com/1tordroid/Droid-Stream');
    expect(urls('Tordroid')).toEqual(expect.arrayContaining(['https://tordroid.com', 'https://t.me/Tordroid_admin']));
    expect(urls('Tordroid Plus')).toEqual(['https://plus.tordroid.com', 'https://github.com/1tordroid/pikpak-plus']);
    expect(urls('pikpak-plus by Bharath Ganji')).toEqual(['https://github.com/bharathganji/pikpak-plus']);
    expect(urls('Titanium Browser')).toEqual(['https://github.com/jqssun/android-titanium-browser']);
    expect(urls('Ghost Downloader 3')).toEqual(['https://github.com/XiaoYouChR/Ghost-Downloader-3']);
    for (const name of ['Trakt', 'Simkl', 'AniList', 'Jikan', 'AniSkip', 'SponsorBlock', 'IntroDB', 'OpenSubtitles', 'iptv-org', 'PikPak',
      'TorBox', 'Real-Debrid', 'AllDebrid', 'Premiumize', 'Offcloud', 'Debrid-Link', 'Jellyfin', 'Emby', 'Plex', 'Cloudflare WARP',
      'usque', 'ByeDPI', 'Bouncy Castle', 'Apache Commons Net', 'smbj', 'NanoHTTPD', 'libtorrent4j', 'yt-dlp', 'yt-dlp-ejs', 'Chaquopy',
      'Python (CPython)', 'FFmpeg', 'FFmpegKit', 'zustand', 'cheerio', 'Notifee', 'qBittorrent', 'LibreTorrent', 'Transmission', 'VidHub',
      '1DM', 'YTDLnis', 'Seal', 'SnapTube', 'Netflix', 'Morphe', 'EasyList', 'EasyPrivacy', 'IndianList']) {
      expect(findEntry(name)).toBeDefined();
    }
  });
});

describe('TMDB logo', () => {
  it('draws the same shape as the official logo file in assets/brand', () => {
    const svg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'brand', 'tmdb-logo.svg'), 'utf8');
    expect(svg).toContain(` d="${TMDB_LOGO_PATH}"`);
    expect(svg).toContain('viewBox="0 0 489.04 35.4"');
    expect(TMDB_LOGO_XML).toContain('<stop offset="0" stop-color="#90cea1"/>');
  });

  it('shows next to the TMDB notice and nowhere else', () => {
    mockIsTV = true;
    const tree = render(<CreditsAndLicences />);
    const logos = tree.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'tmdb-logo' && node.props.accessibilityLabel === 'TMDB logo');
    expect(logos).toHaveLength(1);
    expect(lines(tree)).toContain('This product uses the TMDB API but is not endorsed or certified by TMDB.');
  });
});

describe('Credits and licences page', () => {
  it('builds one row per section and entry', () => {
    const rows = buildCreditRows();
    expect(rows).toHaveLength(ALL_SECTIONS.length + allEntries.length);
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
  });

  it('opens from the Credits route with the version and a jump to every section', () => {
    const tree = render(<Credits />);
    const text = lines(tree);
    expect(text).toContain('Credits and licences');
    expect(text.some(line => line.startsWith('Droid Stream 5.6.0 (222).'))).toBe(true);
    for (const section of ALL_SECTIONS) {
      expect(tree.root.findAll(node => node.props.accessibilityLabel === `Go to ${section.title}` && node.props.onPress).length).toBeGreaterThan(0);
    }
  });

  it('still renders the old Open-source licences route, opened at the licence list', () => {
    jest.useFakeTimers();
    const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    const tree = render(<OpenSourceLicenses />);
    expect(lines(tree)).toContain('Credits and licences');
    const list = tree.root.findByProps({testID: 'credits-list'});
    act(() => {
      list.props.onLayout?.({nativeEvent: {layout: {x: 0, y: 0, width: 400, height: 800}}});
      jest.runOnlyPendingTimers();
    });
    const licenceIndex = buildCreditRows().findIndex(row => row.kind === 'section' && row.section.id === 'licences');
    expect(scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({index: licenceIndex}));
    jest.useRealTimers();
  });

  it('on TV, mounts every entry with each link as a focusable button that opens the browser', () => {
    mockIsTV = true;
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const tree = render(<CreditsAndLicences />);
    const text = lines(tree);
    expect(text).toContain('Open-source licences');
    for (const {entry} of allEntries) {
      expect(text).toContain(entry.name);
      for (const link of entry.links) {
        const buttons = tree.root.findAll(
          node => node.props.accessibilityLabel === `${entry.name}, ${link.label}` && node.props.focusable === true && node.props.onPress,
        );
        expect(buttons.length).toBeGreaterThan(0);
      }
      if (!entry.links.length) {
        expect(tree.root.findAll(node => node.props.accessibilityLabel === entry.name && node.props.focusable === true).length).toBeGreaterThan(0);
      }
    }
    const repo = tree.root.findAll(node => node.props.accessibilityLabel === 'Droid Stream, Repository' && node.props.onPress)[0];
    act(() => repo.props.onPress());
    expect(openURL).toHaveBeenCalledWith('https://github.com/1tordroid/Droid-Stream');
  });
});

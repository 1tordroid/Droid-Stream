// The TV guide for Favourites and Recent: channels grouped by their source,
// each source's guide loaded, and catch-up kept with saved channels.
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {ToastAndroid} from 'react-native';

jest.mock('../src/components/ui/Text', () => {
  const {Text: NativeText, TextInput: Input} = require('react-native');
  return {__esModule: true, default: NativeText, RawText: NativeText, RawTextInput: Input};
});
jest.mock('../src/components/torrentSearch/Chip', () => {
  const {Pressable, Text: NativeText} = require('react-native');
  return {
    __esModule: true,
    default: ({label, onPress, accessibilityLabel}: any) => (
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} onPress={onPress}>
        <NativeText>{label}</NativeText>
      </Pressable>
    ),
  };
});
jest.mock('../src/components/ui/Button', () => {
  const {Pressable, Text: NativeText} = require('react-native');
  return {__esModule: true, default: ({children, onPress, accessibilityLabel}: any) => (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress}><NativeText>{children}</NativeText></Pressable>
  )};
});
jest.mock('react-native-reanimated', () => require('../__mocks__/reanimatedStub'));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('../src/lib/livetv/reminders', () => ({
  reminderId: (key: string, start: number) => `${key}@${start}`,
  reminderIds: () => new Set<string>(),
  toggleReminder: jest.fn(),
}));
jest.mock('../src/lib/livetv/guideLoader', () => ({
  ...jest.requireActual('../src/lib/livetv/guideLoader'),
  loadXmltvGuide: jest.fn(),
}));

import LiveGuide from '../src/screens/livetv/LiveGuide';
import {catchupAttrsOf} from '../src/lib/livetv/catchup';
import {isMixedGuide, planGuideLoads, withPlaylistDetails} from '../src/lib/livetv/guideSources';
import {loadXmltvGuide} from '../src/lib/livetv/guideLoader';
import {addPlaylist, listFavourites, listRecent, pushRecent, toggleFavourite} from '../src/lib/livetv/store';
import {normalizeChannelName} from '../src/lib/livetv/xmltv';

const HOUR = 3600_000;

describe('guide plan for mixed lists', () => {
  it('knows Favourites and Recent', () => {
    expect(isMixedGuide('favourites')).toBe(true);
    expect(isMixedGuide('recent')).toBe(true);
    expect(isMixedGuide('iptv-org')).toBe(false);
  });

  it('keeps only catch-up attributes', () => {
    expect(catchupAttrsOf({catchup: 'append', 'catchup-source': '?utc={utc}', 'catchup-days': '3', 'tvg-logo': 'x', 'group-title': 'News'})).toEqual({
      catchup: 'append',
      'catchup-source': '?utc={utc}',
      'catchup-days': '3',
    });
    expect(catchupAttrsOf({'tvg-logo': 'x'})).toBeUndefined();
    expect(catchupAttrsOf(undefined)).toBeUndefined();
  });

  it('groups channels by guide address and leaves out JioTV and sources without one', () => {
    const urls: Record<string, string | undefined> = {a: 'https://g/a.xml', b: 'https://g/a.xml', c: 'https://g/c.xml.gz', d: undefined};
    const loads = planGuideLoads(
      [
        {sourceId: 'a', url: 'https://s/1', name: 'One HD', tvgId: 'one'},
        {sourceId: 'b', url: 'https://s/2', name: 'Two'},
        {sourceId: 'c', url: 'https://s/3', name: 'Three', tvgName: 'Three TV'},
        {sourceId: 'd', url: 'https://s/4', name: 'Four'},
        {sourceId: 'jio', url: 'jiotv://channel/143', name: 'Jio News'},
      ],
      id => urls[id],
      normalizeChannelName,
    );
    expect(loads.map(load => [load.url, load.sourceIds, load.ids, load.names])).toEqual([
      ['https://g/a.xml', ['a', 'b'], ['one'], ['one', 'two']],
      ['https://g/c.xml.gz', ['c'], [], ['threetv', 'three']],
    ]);
  });

  it('fills catch-up and tvg-name for channels saved before they were kept', () => {
    const saved = [
      {id: 'x', sourceId: 'p1', name: 'X'},
      {id: 'y', sourceId: 'p2', name: 'Y'},
    ];
    const playlist = [{id: 'x', tvgName: 'X TV', attrs: {catchup: 'shift', 'catchup-days': '2', 'tvg-logo': 'l'}}, {id: 'y', attrs: {catchup: 'shift'}}];
    expect(withPlaylistDetails(saved, 'p1', playlist, catchupAttrsOf)).toEqual([
      {id: 'x', sourceId: 'p1', name: 'X', tvgName: 'X TV', attrs: {catchup: 'shift', 'catchup-days': '2'}},
      {id: 'y', sourceId: 'p2', name: 'Y'},
    ]);
  });

  it('saves catch-up attributes and tvg-name with favourites and recent', () => {
    const channel = {id: 'cu', name: 'Catch Up', url: 'http://x/cu.m3u8', tvgName: 'CatchUp', attrs: {catchup: 'append', 'catchup-source': '?s={utc}', 'tvg-logo': 'l'}};
    toggleFavourite(channel, 'iptv-org');
    expect(listFavourites().find(item => item.id === 'cu')).toMatchObject({tvgName: 'CatchUp', attrs: {catchup: 'append', 'catchup-source': '?s={utc}'}});
    toggleFavourite(channel, 'iptv-org');
    pushRecent(channel, 'iptv-org');
    expect(listRecent()[0].attrs).toEqual({catchup: 'append', 'catchup-source': '?s={utc}'});
  });
});

describe('TV guide for Favourites', () => {
  const playlistText = (guide: string, id: string, name: string, extra = '') =>
    `#EXTM3U url-tvg="${guide}"\n#EXTINF:-1 tvg-id="${id}"${extra},${name}\nhttps://s.example/${id}.m3u8\n`;

  it('loads the guide of each source and plays from the right source', async () => {
    jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
    const one = addPlaylist('Alpha', 'https://lists.example/alpha.m3u');
    const two = addPlaylist('Beta', 'https://lists.example/beta.m3u');
    const texts: Record<string, string> = {
      [one.url]: playlistText('https://guide.example/alpha.xml', 'alpha1', 'Alpha One', ' catchup="append" catchup-source="?utc={utc}" catchup-days="2"'),
      [two.url]: playlistText('https://guide.example/beta.xml', 'beta1', 'Beta One'),
    };
    (global as any).fetch = jest.fn(async (url: string) => ({ok: true, status: 200, text: async () => texts[url]}));
    // Saved before catch-up was kept with favourites: no attributes.
    toggleFavourite({id: 'alpha1|https://s.example/alpha1.m3u8', name: 'Alpha One', url: 'https://s.example/alpha1.m3u8', tvgId: 'alpha1', attrs: {}}, one.id);
    toggleFavourite({id: 'beta1|https://s.example/beta1.m3u8', name: 'Beta One', url: 'https://s.example/beta1.m3u8', tvgId: 'beta1', attrs: {}}, two.id);
    const now = Date.now();
    const past = {start: now - 3 * HOUR, stop: now - 2 * HOUR};
    const live = {start: now - HOUR / 2, stop: now + HOUR / 2};
    (loadXmltvGuide as jest.Mock).mockImplementation(async (url: string) => ({
      url,
      fetchedAt: now,
      names: {},
      programmes: url.includes('alpha')
        ? {alpha1: [{...past, title: 'Alpha Morning'}, {...live, title: 'Alpha Now'}]}
        : {beta1: [{...past, title: 'Beta Morning'}, {...live, title: 'Beta Now'}]},
    }));
    const navigate = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LiveGuide navigation={{navigate}} route={{params: {sourceId: 'favourites'}}} />);
    });
    const area = tree.root.findAll(node => typeof node.props.onLayout === 'function' && node.props.style?.flex === 1)[0];
    await act(async () => area.props.onLayout({nativeEvent: {layout: {width: 800, height: 600}}}));

    const loaded = (loadXmltvGuide as jest.Mock).mock.calls.map(([url, request]) => [url, request.ids]);
    expect(loaded).toEqual(
      expect.arrayContaining([
        ['https://guide.example/alpha.xml', ['alpha1']],
        ['https://guide.example/beta.xml', ['beta1']],
      ]),
    );
    const labels = tree.root.findAll(node => typeof node.props.accessibilityLabel === 'string' && node.props.onPress).map(node => node.props.accessibilityLabel as string);
    expect(labels.some(label => label.startsWith('Alpha Now'))).toBe(true);
    expect(labels.some(label => label.startsWith('Beta Now'))).toBe(true);
    // Catch-up comes from the source's playlist for the older favourite.
    expect(labels.some(label => label.startsWith('Alpha Morning') && label.endsWith('replay available'))).toBe(true);
    expect(labels.some(label => label.startsWith('Beta Morning') && label.endsWith('replay available'))).toBe(false);

    const watchBeta = tree.root.findAll(node => node.props.accessibilityLabel === 'Watch Beta One live' && node.props.onPress)[0];
    await act(async () => watchBeta.props.onPress());
    expect(navigate).toHaveBeenCalledWith('Player', expect.objectContaining({primaryTitle: 'Beta One', secondaryTitle: 'Beta'}));
    await act(async () => tree.unmount());
  }, 60_000);
});

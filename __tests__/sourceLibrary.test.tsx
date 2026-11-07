// The library screen of a source: tabs, sorts, search, empty states, the
// TV first-focus guard and opening Info.
import React from 'react';
import {Text, TextInput} from 'react-native';
import renderer, {act} from 'react-test-renderer';

jest.mock('../src/lib/tv/constants', () => ({...jest.requireActual('../src/lib/tv/constants'), isTV: true}));
jest.mock('expo-crypto', () => ({randomUUID: () => 'install-a'}));
jest.mock('../src/components/ui/Text', () => {
  const {Text: RNText, TextInput: Input} = require('react-native');
  return {__esModule: true, default: RNText, RawText: RNText, RawTextInput: Input};
});
jest.mock('../src/components/tv', () => ({TVFocusable: 'TVFocusable'}));
jest.mock('../src/components/MediaPosterCard', () => 'MediaPosterCard');
jest.mock('../src/components/netlib/FixMatch', () => 'FixMatch');
jest.mock('../src/components/ui/MaterialDialogSurface', () => 'Dialog');
jest.mock('../src/components/torrentSearch/Chip', () => ({label, onPress, selected}: any) => {
  const {Text: RNText} = require('react-native');
  return <RNText accessibilityRole="button" accessibilityState={{selected}} onPress={onPress}>{label}</RNText>;
});
jest.mock('@shopify/flash-list', () => {
  const ReactLib = require('react');
  const {View} = require('react-native');
  return {
    FlashList: ReactLib.forwardRef(({data, renderItem, ListHeaderComponent, ListEmptyComponent}: any, _ref: unknown) => (
      <View>
        {ListHeaderComponent}
        {data.length ? data.map((item: any, index: number) => <View key={item.id}>{renderItem({item, index})}</View>) : ListEmptyComponent}
      </View>
    )),
  };
});
jest.mock('@react-navigation/native', () => {
  const ReactLib = require('react');
  return {useFocusEffect: (effect: () => void | (() => void)) => ReactLib.useEffect(effect, [effect])};
});
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('../src/lib/sources/smb', () => ({listSmbShare: jest.fn(), canStreamSmb: () => false, normalizeSmbPath: (p: string) => p}));

import {SourceLibraryView, visibleItems} from '../src/screens/library/SourceLibrary';
import {sourceCardDescription} from '../src/screens/library/LibraryHub';
import {saveLibrary} from '../src/lib/netlib/cache';
import {saveSource} from '../src/lib/sources/vault';
import type {NetlibItem} from '../src/lib/netlib/types';

const item = (id: string, kind: NetlibItem['kind'], title: string, extra: Partial<NetlibItem> = {}): NetlibItem => ({
  id: `w|${kind}|${id}|`,
  sourceId: 'w',
  kind,
  title,
  versions: kind === 'show' ? [] : [{key: `netlib:v:w:${id}`, name: `${title}.mkv`}],
  episodes: kind === 'show' ? [{season: 1, episode: 1, versions: [{key: `netlib:v:w:${id}e1`, name: 'e1.mkv'}]}] : [],
  added: 0,
  ...extra,
});

const ITEMS = [
  item('b', 'movie', 'Brazil', {year: 1985, added: 3, match: {type: 'movie', title: 'Brazil', poster: 'p.jpg', rating: '7.8'}}),
  item('a', 'movie', 'Alien', {year: 1979, added: 1}),
  item('c', 'movie', 'Clip', {added: 9}),
  item('s', 'show', 'Severance', {added: 5}),
];

describe('source library', () => {
  let tree: renderer.ReactTestRenderer;
  const navigation = {navigate: jest.fn(), goBack: jest.fn(), getState: () => ({routeNames: ['SourceLibrary', 'Info']})};

  beforeEach(() => {
    navigation.navigate.mockClear();
    saveSource({id: 'w', kind: 'webdav', name: 'Home NAS', server: 'https://dav.local', username: 'u', secret: 'p'});
    saveLibrary({sourceId: 'w', scannedAt: 1, items: ITEMS});
  });
  afterEach(() => act(() => tree?.unmount()));

  const render = async () => {
    await act(async () => {
      tree = renderer.create(<SourceLibraryView sourceId="w" navigation={navigation} />);
    });
  };
  const posters = () => tree.root.findAll(node => (node.type as unknown) === 'MediaPosterCard');
  const press = async (label: string) => {
    const chip = tree.root.findAll(node => node.type === Text && node.props.children === label)[0];
    await act(async () => chip.props.onPress());
  };

  it('sorts, filters and searches one tab', () => {
    expect(visibleItems(ITEMS, 'movies', 'title', '').map(entry => entry.title)).toEqual(['Alien', 'Brazil']);
    expect(visibleItems(ITEMS, 'movies', 'year', '').map(entry => entry.title)).toEqual(['Brazil', 'Alien']);
    expect(visibleItems(ITEMS, 'other', 'added', '').map(entry => entry.title)).toEqual(['Clip']);
    expect(visibleItems(ITEMS, 'movies', 'title', 'braz').map(entry => entry.title)).toEqual(['Brazil']);
  });

  it('shows the movie grid with counts and opens Info for a poster', async () => {
    await render();
    expect(tree.root.findAll(node => node.type === Text && node.props.children === '2 movies · 1 shows · 1 other')).toHaveLength(1);
    expect(posters().map(poster => poster.props.title)).toEqual(['Alien', 'Brazil']);
    await act(async () => posters()[1].props.onPress());
    expect(navigation.navigate).toHaveBeenCalledWith('Info', {link: `netlib:i:${encodeURIComponent('w|movie|b|')}`, provider: 'netlib', poster: 'p.jpg'});
    await press('Shows 1');
    expect(posters().map(poster => poster.props.title)).toEqual(['Severance']);
    expect(posters()[0].props.subtitle).toBe('1 episode');
  });

  it('gives first TV focus to the first poster only until a poster has focus', async () => {
    await render();
    expect(posters().map(poster => Boolean(poster.props.hasTVPreferredFocus))).toEqual([true, false]);
    await act(async () => posters()[0].props.onFocus());
    expect(posters().some(poster => poster.props.hasTVPreferredFocus)).toBe(false);
  });

  it('says when a search finds nothing', async () => {
    await render();
    await act(async () => tree.root.findByType(TextInput).props.onChangeText('zzz'));
    expect(posters()).toHaveLength(0);
    expect(tree.root.findAll(node => node.type === Text && node.props.children === 'No matches')).toHaveLength(1);
  });

  it('describes source cards in the Library hub', () => {
    expect(sourceCardDescription({id: 'w', kind: 'webdav', server: 'x', authState: 'ok'}, 'WebDAV')).toBe('WebDAV · 2 movies · 1 shows · 1 other');
    expect(sourceCardDescription({id: 'n', kind: 'smb', server: 'x', authState: 'ok'}, 'SMB')).toBe('SMB · tap to build its poster library');
    expect(sourceCardDescription({id: 'j', kind: 'jellyfin', server: 'http://jf', authState: 'ok'}, 'Jellyfin')).toBe('Jellyfin · http://jf');
  });
});

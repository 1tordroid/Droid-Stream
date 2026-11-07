// Live TV filters: quality and language chips with counts, saved per source and profile.
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Text, ToastAndroid} from 'react-native';

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

import LiveTV from '../src/screens/livetv/LiveTV';
import {getChannelFilters} from '../src/lib/livetv/store';

const M3U = `#EXTM3U
#EXTINF:-1 tvg-id="aaj" tvg-language="Hindi" group-title="News",Aaj Tak (720p) [Geo-blocked]
https://s.example/aaj.m3u8
#EXTINF:-1 tvg-id="ndtv" tvg-language="English" group-title="News",NDTV 24x7 (1080p)
https://s.example/ndtv.m3u8
#EXTINF:-1 tvg-id="sun" group-title="Tamil Entertainment",Sun TV (1080p)
https://s.example/sun.m3u8
#EXTINF:-1 tvg-id="dd" group-title="General",DD National
https://s.example/dd.m3u8
`;

const textOf = (node: renderer.ReactTestInstance): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');
const lines = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(textOf);
const press = (tree: renderer.ReactTestRenderer, label: string) =>
  act(async () => tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0].props.onPress());
const tiles = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findAll(node => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith('Play ') && typeof node.props.onPress === 'function')
    .map(node => node.props.accessibilityLabel.slice(5))
    .filter((label, index, list) => list.indexOf(label) === index);

it('filters by quality and language, shows badges, and remembers the choice', async () => {
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  (global as any).fetch = jest.fn().mockResolvedValue({ok: true, status: 200, text: async () => M3U});
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<LiveTV navigation={{navigate: jest.fn()}} />);
  });
  expect(tiles(tree)).toEqual(['Aaj Tak (720p) [Geo-blocked]', 'NDTV 24x7 (1080p)', 'Sun TV (1080p)', 'DD National']);
  // Tiles hide "(1080p)" and show a badge; the full name stays for screen readers.
  expect(lines(tree)).toEqual(expect.arrayContaining(['Aaj Tak [Geo-blocked]', 'NDTV 24x7', '720p', '1080p']));

  await press(tree, 'Filters');
  expect(lines(tree)).toEqual(expect.arrayContaining(['Quality', 'Language', 'Hindi', 'English', 'Tamil', 'Unknown']));

  await press(tree, '1080p');
  expect(tiles(tree)).toEqual(['NDTV 24x7 (1080p)', 'Sun TV (1080p)']);
  await press(tree, 'Tamil');
  expect(tiles(tree)).toEqual(['Sun TV (1080p)']);
  await press(tree, 'English');
  expect(tiles(tree)).toEqual(['NDTV 24x7 (1080p)', 'Sun TV (1080p)']);
  expect(lines(tree)).toContain('2 of 4 channels');
  expect(getChannelFilters('iptv-org')).toMatchObject({resolution: '1080', languages: ['Tamil', 'English']});

  // Opening Live TV again keeps the filters.
  await act(async () => tree.unmount());
  await act(async () => {
    tree = renderer.create(<LiveTV navigation={{navigate: jest.fn()}} />);
  });
  expect(tiles(tree)).toEqual(['NDTV 24x7 (1080p)', 'Sun TV (1080p)']);
  expect(lines(tree)).toContain('Filters (2)');

  await press(tree, 'Reset filters');
  expect(tiles(tree)).toHaveLength(4);
  expect(getChannelFilters('iptv-org')).toMatchObject({resolution: 'all', languages: []});

  // The badge can be turned off to show names as the playlist has them.
  await press(tree, 'Filters');
  await press(tree, 'Quality badge on. Names hide tags like (1080p).');
  expect(lines(tree)).toContain('NDTV 24x7 (1080p)');
  await act(async () => tree.unmount());
});

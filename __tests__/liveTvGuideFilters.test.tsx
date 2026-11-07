// The TV guide uses the filters saved on the Live TV screen.
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
jest.mock('../src/lib/livetv/reminders', () => ({
  reminderId: (key: string, start: number) => `${key}@${start}`,
  reminderIds: () => new Set<string>(),
  toggleReminder: jest.fn(),
}));

import LiveGuide from '../src/screens/livetv/LiveGuide';
import {DEFAULT_FILTERS} from '../src/lib/livetv/filters';
import {getChannelFilters, setChannelFilters} from '../src/lib/livetv/store';

const M3U = `#EXTM3U
#EXTINF:-1 tvg-id="aaj" tvg-language="Hindi" group-title="News",Aaj Tak (720p)
https://s.example/aaj.m3u8
#EXTINF:-1 tvg-id="ndtv" tvg-language="English" group-title="News",NDTV 24x7 (1080p)
https://s.example/ndtv.m3u8
#EXTINF:-1 tvg-id="sun" tvg-language="Tamil" group-title="Entertainment",Sun TV (1080p)
https://s.example/sun.m3u8
`;

const textOf = (node: renderer.ReactTestInstance): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');
const lines = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(textOf);
const press = (tree: renderer.ReactTestRenderer, label: string) =>
  act(async () => tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0].props.onPress());
const rows = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findAll(node => typeof node.props.accessibilityLabel === 'string' && /^Watch .* live$/.test(node.props.accessibilityLabel) && typeof node.props.onPress === 'function')
    .map(node => node.props.accessibilityLabel.slice(6, -5))
    .filter((label, index, list) => list.indexOf(label) === index);

it('shows only the channels the saved filters allow, and saves changes made here', async () => {
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  (global as any).fetch = jest.fn().mockResolvedValue({ok: true, status: 200, text: async () => M3U});
  setChannelFilters('iptv-org', {...DEFAULT_FILTERS, resolution: '1080', group: 'News'});
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<LiveGuide navigation={{navigate: jest.fn()}} route={{params: {sourceId: 'iptv-org'}}} />);
  });
  const area = tree.root.findAll(node => typeof node.props.onLayout === 'function' && node.props.style?.flex === 1)[0];
  await act(async () => area.props.onLayout({nativeEvent: {layout: {width: 800, height: 600}}}));
  expect(rows(tree)).toEqual(['NDTV 24x7 (1080p)']);
  expect(lines(tree)).toEqual(expect.arrayContaining(['Free Indian channels · News', 'Filters (2)', 'NDTV 24x7', '1080p']));

  await press(tree, 'Filters, 2 on');
  await press(tree, 'Tamil');
  expect(rows(tree)).toEqual([]);
  expect(lines(tree)).toContain('No channels match these filters.');
  await press(tree, 'Reset filters');
  expect(rows(tree)).toEqual(['Aaj Tak (720p)', 'NDTV 24x7 (1080p)', 'Sun TV (1080p)']);
  expect(getChannelFilters('iptv-org')).toEqual(DEFAULT_FILTERS);
  await act(async () => tree.unmount());
}, 60_000);

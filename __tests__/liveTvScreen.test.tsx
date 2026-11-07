// Live TV loads the free channel list, filters it, and opens a channel live.
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

const M3U = `#EXTM3U
#EXTINF:-1 tvg-id="dd" tvg-logo="https://l/dd.png" group-title="General",DD National
https://s.example/dd.m3u8
#EXTINF:-1 tvg-id="news" group-title="News",News One
#EXTVLCOPT:http-user-agent=TestAgent
https://s.example/news.m3u8
`;

const textOf = (node: renderer.ReactTestInstance): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');
const lines = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(textOf);
const pressable = (tree: renderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];

it('shows channels with groups and opens one in the player as live', async () => {
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  (global as any).fetch = jest.fn().mockResolvedValue({ok: true, status: 200, text: async () => M3U});
  const navigate = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<LiveTV navigation={{navigate}} />);
  });
  expect(fetch).toHaveBeenCalledWith('https://iptv-org.github.io/iptv/countries/in.m3u', expect.anything());
  const text = lines(tree);
  expect(text).toEqual(expect.arrayContaining(['DD National', 'News One', 'General', 'News']));
  expect(text.some(line => /free-to-air/.test(line))).toBe(true);

  await act(async () => pressable(tree, 'News').props.onPress());
  expect(lines(tree)).not.toContain('DD National');

  await act(async () => pressable(tree, 'Play News One').props.onPress());
  expect(navigate).toHaveBeenCalledWith('Player', expect.objectContaining({
    directUrl: 'https://s.example/news.m3u8',
    live: true,
    initialStream: expect.objectContaining({headers: {'User-Agent': 'TestAgent'}, type: 'm3u8'}),
  }));
  await act(async () => tree.unmount());
});

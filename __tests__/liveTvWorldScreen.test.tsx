// Live TV starts on the detected country's free channels and lets you change it.
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {NativeModules, Text, TextInput, ToastAndroid} from 'react-native';

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
import {resetDetectedCountryForTests} from '../src/lib/livetv/deviceCountry';
import {getSavedLiveView, listRecentCountries} from '../src/lib/livetv/world';
import {openStore} from '../src/lib/storage/openStore';

const M3U = `#EXTM3U
#EXTINF:-1 tvg-id="bbc.uk" group-title="General",BBC One
https://s.example/bbc.m3u8
`;
const UK = 'https://iptv-org.github.io/iptv/countries/uk.m3u';
const INDIA = 'https://iptv-org.github.io/iptv/countries/in.m3u';

const textOf = (node: renderer.ReactTestInstance): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');
const lines = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(textOf);
const pressable = (tree: renderer.ReactTestRenderer, label: string | RegExp) =>
  tree.root.findAll(node =>
    typeof node.props.onPress === 'function' &&
    typeof node.props.accessibilityLabel === 'string' &&
    (typeof label === 'string' ? node.props.accessibilityLabel === label : label.test(node.props.accessibilityLabel)),
  )[0];

const detect = (sim: string) => {
  (NativeModules as any).VegaDeviceMemory = {getConstants: () => ({simCountry: sim, networkCountry: '', localeCountry: ''})};
  resetDetectedCountryForTests();
};
const render = async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<LiveTV navigation={{navigate: jest.fn()}} />);
  });
  return tree;
};

beforeEach(() => {
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  (global as any).fetch = jest.fn().mockResolvedValue({ok: true, status: 200, text: async () => M3U});
});
afterAll(() => {
  delete (NativeModules as any).VegaDeviceMemory;
  resetDetectedCountryForTests();
});

it('opens Free Indian channels as before when the phone is in India', async () => {
  detect('in');
  const tree = await render();
  expect(fetch).toHaveBeenCalledWith(INDIA, expect.anything());
  expect(fetch).not.toHaveBeenCalledWith(UK, expect.anything());
  expect(lines(tree).some(line => /Change country/.test(line))).toBe(false);
  expect(getSavedLiveView()).toBeUndefined();
  await act(async () => tree.unmount());
});

it('opens the detected country, changes it, and remembers the choice', async () => {
  detect('gb');
  let tree = await render();
  expect(fetch).toHaveBeenCalledWith(UK, expect.anything());
  let text = lines(tree);
  expect(text).toEqual(expect.arrayContaining(['🇬🇧 United Kingdom', 'Detected from your SIM']));
  expect(text).toEqual(expect.arrayContaining(['BBC One', 'Change country', 'World']));
  expect(text.some(line => /free-to-air/.test(line))).toBe(true);

  // The country list starts with the detected country.
  await act(async () => pressable(tree, 'Change country').props.onPress());
  expect(pressable(tree, /^United Kingdom, Detected from your SIM/)).toBeDefined();
  const input = tree.root.findAll(node => node.type === TextInput && node.props.accessibilityLabel === 'Search countries')[0];
  await act(async () => input.props.onChangeText('france'));
  await act(async () => pressable(tree, /^France/).props.onPress());
  expect(fetch).toHaveBeenCalledWith('https://iptv-org.github.io/iptv/countries/fr.m3u', expect.anything());
  text = lines(tree);
  expect(text).toContain('🇫🇷 France');
  expect(getSavedLiveView()).toBe('world:fr');

  // Picking India goes to the existing Free Indian channels source.
  await act(async () => pressable(tree, 'Change country').props.onPress());
  await act(async () => tree.root.findAll(node => node.type === TextInput && node.props.accessibilityLabel === 'Search countries')[0].props.onChangeText('india'));
  await act(async () => pressable(tree, /^India, .*Opens Free Indian channels/).props.onPress());
  // (The Indian list is cached from the first test.)
  expect(lines(tree).some(line => /Change country/.test(line))).toBe(false);
  expect(getSavedLiveView()).toBe('iptv-org');
  expect(listRecentCountries()).toEqual(['IN', 'FR']);

  // World goes back to the country picked last.
  await act(async () => pressable(tree, 'World').props.onPress());
  expect(lines(tree)).toContain('🇫🇷 France');
  expect(getSavedLiveView()).toBe('world:fr');
  await act(async () => tree.unmount());

  // Opened again, Live TV starts on the list picked last.
  tree = await render();
  expect(lines(tree)).toEqual(expect.arrayContaining(['🇫🇷 France', 'BBC One']));
  await act(async () => tree.unmount());
});

it('shows a short note for a country with no free channels', async () => {
  openStore('droid-stream-livetv').removeItem('liveView');
  detect('aq');
  (global as any).fetch = jest.fn().mockResolvedValue({ok: false, status: 404, text: async () => ''});
  const tree = await render();
  expect(lines(tree)).toContain('No free channels listed for this country.');
  await act(async () => tree.unmount());
});

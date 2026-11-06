// Debrid and cloud says when a service refused its saved key, and what to do.
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {KeyboardAvoidingView, Text, TextInput, ToastAndroid} from 'react-native';

jest.mock('../src/components/ui/Text', () => {
  const {Text: NativeText, TextInput: Input} = require('react-native');
  return {__esModule: true, default: NativeText, RawText: NativeText, RawTextInput: Input};
});
jest.mock('../src/components/torrentSearch/Chip', () => {
  const {Pressable, Text: NativeText} = require('react-native');
  return {
    __esModule: true,
    default: ({label, onPress}: any) => (
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
        <NativeText>{label}</NativeText>
      </Pressable>
    ),
  };
});
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/lib/torrentSearch/actions', () => ({downloadDebridFiles: jest.fn(), playDebridFile: jest.fn()}));
jest.mock('../src/lib/sources/vault', () => ({readPikPakAccount: () => undefined}));

import {getService, readDebridSettings, writeDebridSettings} from '../src/lib/debrid';
import DebridSettings from '../src/screens/torrents/DebridSettings';

const json = (body: unknown) => ({ok: true, status: 200, text: async () => JSON.stringify(body)}) as any;
const reply = (body: unknown, status: number) => ({ok: status < 400, status, text: async () => JSON.stringify(body)}) as any;

const textOf = (node: renderer.ReactTestInstance): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');
const lines = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(textOf);
const pressable = (tree: renderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];

let mounted: renderer.ReactTestRenderer[] = [];
const render = async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<DebridSettings navigation={{navigate: jest.fn()}} />);
  });
  mounted.push(tree);
  return tree;
};

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  // Every request in these tests is answered below; anything else fails instead of reaching the network.
  jest.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('Unexpected request'));
  writeDebridSettings({...readDebridSettings(), keys: {}});
});

afterEach(() => {
  mounted.forEach(tree => act(() => tree.unmount()));
  mounted = [];
});

it('shows a refused key instead of connected until a check with it works again', async () => {
  writeDebridSettings({...readDebridSettings(), keys: {torbox: 'tb-key', realdebrid: 'rd-key'}});
  const fetchMock = (global.fetch as jest.Mock).mockResolvedValueOnce(reply({success: false, error: 'BAD_TOKEN'}, 403));
  await getService('torbox').account('tb-key').catch(() => undefined);

  const tree = await render();
  expect(lines(tree)).toContain('Instant cache check · Key rejected - paste a new key');
  expect(lines(tree)).toContain('Cache shows after adding · connected');
  expect(readDebridSettings().keys.torbox).toBe('tb-key');

  fetchMock.mockResolvedValueOnce(json({success: true, data: {email: 'me@example.com', plan: 1}}));
  await act(async () => {
    pressable(tree, 'TorBox settings').props.onPress();
  });
  await act(async () => {
    await pressable(tree, 'Check account').props.onPress();
  });
  expect(lines(tree)).toContain('Instant cache check · connected');
  expect(lines(tree)).toContain('me@example.com · premium');
});

it('shows the short reason after Check account and clears it when a new key is pasted', async () => {
  writeDebridSettings({...readDebridSettings(), keys: {premiumize: 'old-key'}});
  (global.fetch as jest.Mock).mockResolvedValueOnce(json({status: 'error', message: 'Not logged in.', code: 'authentication_failed'}));
  const tree = await render();
  await act(async () => {
    pressable(tree, 'Premiumize settings').props.onPress();
  });
  await act(async () => {
    await pressable(tree, 'Check account').props.onPress();
  });
  expect(lines(tree)).toContain('Instant cache check · Key rejected - paste a new key');
  expect(lines(tree)).toContain('Failed: Key rejected - paste a new key');

  const input = tree.root.findAll(node => node.type === TextInput && node.props.accessibilityLabel === 'Premiumize API key')[0];
  // The key field stays above the keyboard and closes it with Done.
  expect(tree.root.findAllByType(KeyboardAvoidingView).length).toBeGreaterThan(0);
  expect(input.props.returnKeyType).toBe('done');
  await act(async () => {
    input.props.onEndEditing({nativeEvent: {text: ' new-key '}});
  });
  expect(readDebridSettings().keys.premiumize).toBe('new-key');
  expect(lines(tree)).toContain('Instant cache check · connected');
  expect(lines(tree).some(line => line.startsWith('Failed'))).toBe(false);
});

it('asks to confirm the AllDebrid email when AllDebrid blocks a new location', async () => {
  writeDebridSettings({...readDebridSettings(), keys: {alldebrid: 'ad-key'}});
  (global.fetch as jest.Mock).mockResolvedValueOnce(json({status: 'error', error: {code: 'AUTH_BLOCKED', message: 'You are logging from a new location, device or app'}}));
  await getService('alldebrid').account('ad-key').catch(() => undefined);

  const tree = await render();
  expect(lines(tree)).toContain('Cache shows after adding · AllDebrid blocked this new location - confirm the email AllDebrid sent');
  await act(async () => {
    pressable(tree, 'AllDebrid settings').props.onPress();
  });
  expect(lines(tree)).toContain('After you confirm it, tap Check account.');
});

it('updates an open screen when a call elsewhere learns the key was refused', async () => {
  writeDebridSettings({...readDebridSettings(), keys: {offcloud: 'oc-key'}});
  const tree = await render();
  expect(lines(tree)).toContain('Instant cache check · connected');
  (global.fetch as jest.Mock).mockResolvedValueOnce(reply({error: 'Unauthorized'}, 401));
  await act(async () => {
    await getService('offcloud').checkCached('oc-key', ['c'.repeat(40)]).catch(() => undefined);
  });
  expect(lines(tree)).toContain('Instant cache check · Key rejected - paste a new key');
});

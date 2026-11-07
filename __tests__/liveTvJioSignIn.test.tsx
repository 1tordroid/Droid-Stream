// Live TV's JioTV source: sign in with a Jio number and SMS code, see the
// channel grid, open a channel with a fresh stream, and sign out.
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Text, TextInput, ToastAndroid} from 'react-native';

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

const res = (status: number, body?: unknown) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: {get: () => null},
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body ?? '')),
  });

const textOf = (node: renderer.ReactTestInstance): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');
const lines = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(textOf);
const pressable = (tree: renderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const input = (tree: renderer.ReactTestRenderer, label: string) =>
  tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label)!;

it('signs in with a Jio number and SMS code, plays a channel and signs out', async () => {
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  let otpOk = false;
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('iptv-org')) return res(200, '#EXTM3U\n#EXTINF:-1,DD National\nhttps://s.example/dd.m3u8\n');
    if (url.includes('loginotp/send')) return res(204);
    if (url.includes('loginotp/verify')) {
      return otpOk
        ? res(200, {authToken: 'acc', refreshToken: 'ref', ssoToken: 'sso', sessionAttributes: {user: {subscriberId: 'crm', unique: 'u'}}})
        : res(400, {message: 'Invalid OTP'});
    }
    if (url.includes('getMobileChannelList')) return res(200, {result: [{channel_id: 154, channel_name: 'Comedy Jio', channelCategoryId: 5}]});
    if (url.includes('geturl')) return res(200, {bitrates: {auto: 'https://live.jio.com/c/index.m3u8?hdnea=abc'}});
    if (url.includes('logout')) return res(200, {});
    return res(404, {});
  });
  const navigate = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<LiveTV navigation={{navigate}} />);
  });

  await act(async () => pressable(tree, 'JioTV').props.onPress());
  expect(lines(tree)).toContain('Sign in with Jio');
  expect(lines(tree).some(line => /not affiliated with Jio/.test(line))).toBe(true);
  const phone = input(tree, 'Jio mobile number');
  expect(phone.props).toMatchObject({keyboardType: 'phone-pad', returnKeyType: 'go'});
  expect(tree.root.findAllByType(TextInput).some(node => node.props.accessibilityLabel === 'SMS code')).toBe(false);

  await act(async () => phone.props.onChangeText('98765 43210'));
  await act(async () => pressable(tree, 'Send OTP').props.onPress());
  const code = input(tree, 'SMS code');
  expect(code.props).toMatchObject({keyboardType: 'number-pad', autoComplete: 'sms-otp', returnKeyType: 'go'});
  expect(input(tree, 'Jio mobile number').props.returnKeyType).toBe('next');

  // A wrong code explains itself and stays on the form.
  await act(async () => code.props.onChangeText('111111'));
  await act(async () => input(tree, 'SMS code').props.onSubmitEditing());
  expect(lines(tree).some(line => /code is wrong or has expired/.test(line))).toBe(true);

  otpOk = true;
  await act(async () => input(tree, 'SMS code').props.onChangeText('222222'));
  await act(async () => input(tree, 'SMS code').props.onSubmitEditing());
  expect(lines(tree)).toEqual(expect.arrayContaining(['Signed in as +919876543210', 'Comedy Jio']));

  await act(async () => pressable(tree, 'Play Comedy Jio').props.onPress());
  expect(navigate).toHaveBeenCalledWith('Player', expect.objectContaining({
    live: true,
    episodeList: [{title: 'Comedy Jio', link: 'jiotv:154'}],
    initialStream: expect.objectContaining({
      server: 'JioTV',
      type: 'm3u8',
      link: 'https://live.jio.com/c/index.m3u8?hdnea=abc',
      headers: expect.objectContaining({Cookie: '__hdnea__=abc', ssotoken: 'sso'}),
    }),
  }));

  await act(async () => pressable(tree, 'Sign out of Jio').props.onPress());
  expect(lines(tree)).toContain('Sign in with Jio');
  // Free channels still work without a Jio sign-in.
  await act(async () => pressable(tree, 'Free Indian channels').props.onPress());
  expect(lines(tree)).toContain('DD National');
  await act(async () => tree.unmount());
});

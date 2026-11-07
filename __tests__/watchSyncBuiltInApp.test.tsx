// With app keys built into the build, Trakt and Simkl sign in with a code
// alone, keep using the app that issued the sign-in, and still offer the
// user's own app as an advanced option.
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Linking, Switch, TextInput} from 'react-native';

jest.mock('../src/lib/watchSync/appKeys', () => ({
  builtInTraktApp: () => ({clientId: 'builtin-id', clientSecret: 'builtin-secret'}),
  builtInSimklApp: () => ({clientId: 'builtin-simkl'}),
}));
jest.mock('../src/components/ui/Text', () => {
  const {Text: RNText, TextInput: Input} = require('react-native');
  return {__esModule: true, default: RNText, RawText: RNText, RawTextInput: Input};
});
jest.mock('../src/components/torrentSearch/Chip', () => {
  const {Pressable, Text: RNText} = require('react-native');
  return {
    __esModule: true,
    default: ({label, onPress}: any) => (
      <Pressable accessibilityRole="button" onPress={onPress}>
        <RNText>{label}</RNText>
      </Pressable>
    ),
  };
});
jest.mock('../src/components/QrCode', () => {
  const {Text: RNText} = require('react-native');
  return {__esModule: true, default: ({value}: any) => <RNText>{`QR:${value}`}</RNText>};
});
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('../src/lib/torrentSearch/actions', () => ({toast: jest.fn()}));

import WatchSync from '../src/screens/settings/WatchSync';
import * as sync from '../src/lib/watchSync';

const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});
const HOUR = 3600_000;

const render = async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<WatchSync />);
  });
  return tree;
};
const chip = (tree: renderer.ReactTestRenderer, label: string) => tree.root.findAll(node => node.props.label === label);
const switchFor = (tree: renderer.ReactTestRenderer, label: string) => tree.root.findAllByType(Switch).find(node => node.props.accessibilityLabel === label)!;

describe('built-in watch-sync apps', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.restoreAllMocks();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
    sync.writeSyncSettings({trakt: {enabled: true}, simkl: {enabled: true}, anilist: {enabled: true}});
  });

  it('signs in to Trakt with the built-in app, shows the code and QR code, and saves which app issued it', async () => {
    jest.useFakeTimers();
    try {
      jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      const tree = await render();
      // Only AniList asks for app details.
      expect(tree.root.findAllByType(TextInput).map(input => input.props.accessibilityLabel)).toEqual(['AniList Client ID', 'AniList Paste the AniList token']);
      expect(chip(tree, 'Create app')).toHaveLength(1);

      let polls = 0;
      fetchMock.mockImplementation((url: string) => {
        if (url.endsWith('/oauth/device/code')) return json(200, {user_code: 'WXYZ9876', verification_url: 'https://trakt.tv/activate', device_code: 'dev', interval: 5, expires_in: 600});
        if (url.endsWith('/oauth/device/token')) {
          polls++;
          return polls === 1 ? json(400, {}) : json(200, {access_token: 'a1', refresh_token: 'r1', created_at: Math.floor(Date.now() / 1000), expires_in: 86400});
        }
        if (url.endsWith('/users/me')) return json(200, {username: 'viewer'});
        return json(200, {});
      });
      await act(async () => {
        await chip(tree, 'Sign in')[0].props.onPress();
      });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({client_id: 'builtin-id'});
      const texts = tree.root.findAll(node => typeof node.props.children === 'string').map(node => node.props.children);
      expect(texts).toEqual(expect.arrayContaining(['WXYZ9876', 'QR:https://trakt.tv/activate']));
      expect(chip(tree, 'Cancel')).toHaveLength(1);

      await act(() => jest.advanceTimersByTimeAsync(10_000));
      const tokenCall = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/oauth/device/token'))[1];
      expect(JSON.parse(tokenCall[1].body)).toEqual({code: 'dev', client_id: 'builtin-id', client_secret: 'builtin-secret'});
      expect(sync.readSyncSettings().trakt).toMatchObject({accessToken: 'a1', authApp: 'builtin', username: 'viewer'});
      expect(switchFor(tree, 'Scrobble to Trakt while watching').props.value).toBe(true);
      act(() => tree.unmount());
    } finally {
      jest.useRealTimers();
    }
  });

  it('renews a built-in sign-in with the built-in app and an own-app sign-in with the own app', async () => {
    sync.updateAccount('trakt', {clientId: 'own-id', clientSecret: 'own-secret', useOwnApp: true, accessToken: 'a1', refreshToken: 'r1', authApp: 'builtin', issuedAt: Date.now() - 23 * HOUR, expiresAt: Date.now() + HOUR});
    fetchMock.mockImplementation(() => json(200, {access_token: 'a2', refresh_token: 'r2', created_at: Math.floor(Date.now() / 1000), expires_in: 86400}));
    await sync.traktEnsureFresh();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({client_id: 'builtin-id', client_secret: 'builtin-secret'});

    // Saves from before 5.6.0 have no authApp: they came from the user's own app.
    sync.updateAccount('trakt', {authApp: undefined, useOwnApp: false, issuedAt: Date.now() - 23 * HOUR, expiresAt: Date.now() + HOUR});
    await sync.traktEnsureFresh();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({client_id: 'own-id', client_secret: 'own-secret'});
  });

  it('asks for the own app details when "Use my own app" is on', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const tree = await render();
    await act(async () => {
      switchFor(tree, 'Trakt use my own app').props.onValueChange(true);
    });
    expect(tree.root.findAllByType(TextInput).map(input => input.props.accessibilityLabel)).toEqual(['Trakt Client ID', 'Trakt Client Secret', 'AniList Client ID', 'AniList Paste the AniList token']);
    fetchMock.mockImplementation(() => json(200, {user_code: 'ABCD', verification_url: 'https://trakt.tv/activate', device_code: 'dev', interval: 5, expires_in: 600}));
    const field = (label: string) => tree.root.findAllByType(TextInput).find(input => input.props.accessibilityLabel === label)!;
    await act(async () => {
      field('Trakt Client ID').props.onChangeText('own-id');
      field('Trakt Client Secret').props.onChangeText('own-secret');
    });
    await act(async () => {
      await chip(tree, 'Sign in')[0].props.onPress();
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({client_id: 'own-id'});
    act(() => tree.unmount());
  });

  it('signs in to Simkl with the built-in Client ID and sends it with requests', async () => {
    fetchMock.mockImplementationOnce(() => json(200, {result: 'OK', access_token: 's1'}));
    const code = {userCode: 'PIN1', verificationUrl: 'https://simkl.com/pin', deviceCode: 'PIN1', intervalSeconds: 5, expiresAt: Date.now() + 600_000, app: {...sync.signInApp('simkl')}};
    await expect(sync.simklPollPin(code)).resolves.toBe('approved');
    expect(String(fetchMock.mock.calls[0][0])).toContain('client_id=builtin-simkl');
    expect(sync.readSyncSettings().simkl.authApp).toBe('builtin');
    fetchMock.mockImplementation(() => json(201, {}));
    await sync.syncWatched({title: 'Heat', type: 'movie', imdbId: 'tt0113277'});
    const history = fetchMock.mock.calls.find(([url]) => String(url).includes('simkl.com/sync/history'))!;
    expect(history[1].headers['simkl-api-key']).toBe('builtin-simkl');
  });
});

// The Watch sync screen stays usable with the keyboard open, saves an AniList
// token only once AniList accepts it, says why a sign-in ended, and slows its
// Trakt polling when Trakt asks.
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {KeyboardAvoidingView, Linking, Text, TextInput} from 'react-native';

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
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('../src/lib/torrentSearch/actions', () => ({toast: jest.fn()}));

import WatchSync from '../src/screens/settings/WatchSync';
import * as sync from '../src/lib/watchSync';
import {toast} from '../src/lib/torrentSearch/actions';

const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});
const base64url = (value: string) => Buffer.from(value).toString('base64url');
const jwt = (payload: Record<string, unknown>) => `${base64url('{"alg":"RS256","typ":"JWT"}')}.${base64url(JSON.stringify(payload))}.signature`;

const render = async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<WatchSync />);
  });
  return tree;
};
const inputs = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(TextInput);
const texts = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(node => ([] as unknown[]).concat(node.props.children).join(''));
const chip = (tree: renderer.ReactTestRenderer, label: string) => tree.root.findAll(node => node.props.label === label);

describe('Watch sync screen', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
    sync.writeSyncSettings({trakt: {enabled: true}, simkl: {enabled: true}, anilist: {enabled: true}});
  });

  it('keeps the form above the keyboard and chains the fields: Next moves on, Go signs in', async () => {
    const tree = await render();
    expect(tree.root.findByType(KeyboardAvoidingView).props.behavior).toBe('padding');
    const fields = inputs(tree);
    expect(fields.map(input => [input.props.accessibilityLabel, input.props.returnKeyType])).toEqual([
      ['Trakt Client ID', 'next'],
      ['Trakt Client Secret', 'go'],
      ['Simkl Client ID', 'go'],
      ['AniList Client ID', 'next'],
      ['AniList Paste the AniList token', 'go'],
    ]);
    const field = (label: string) => fields.find(input => input.props.accessibilityLabel === label)!;
    const focusOf = (label: string) => {
      const focus = jest.fn();
      field(label).instance.focus = focus;
      return focus;
    };
    const secretFocus = focusOf('Trakt Client Secret');
    const tokenFocus = focusOf('AniList Paste the AniList token');
    // Next keeps the keyboard open and moves to the next field.
    expect(field('Trakt Client ID').props.submitBehavior).toBe('submit');
    act(() => field('Trakt Client ID').props.onSubmitEditing());
    expect(secretFocus).toHaveBeenCalledTimes(1);
    act(() => field('AniList Client ID').props.onSubmitEditing());
    expect(tokenFocus).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('signs in to Trakt with the details just typed, from Sign in or from Go, while the field still has focus', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    fetchMock.mockImplementation(() => json(200, {user_code: 'ABCD', verification_url: 'https://trakt.tv/activate', device_code: 'dev', interval: 5, expires_in: 600}));
    const tree = await render();
    const field = (label: string) => inputs(tree).find(input => input.props.accessibilityLabel === label)!;
    // Typed only: no onEndEditing has run yet.
    await act(async () => {
      field('Trakt Client ID').props.onChangeText(' typed-id ');
      field('Trakt Client Secret').props.onChangeText('typed-secret');
    });
    expect(sync.readSyncSettings().trakt.clientId).toBeFalsy();
    await act(async () => {
      await chip(tree, 'Sign in')[0].props.onPress();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.trakt.tv/oauth/device/code');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({client_id: 'typed-id'});
    expect(sync.readSyncSettings().trakt).toMatchObject({clientId: 'typed-id', clientSecret: 'typed-secret'});

    await act(async () => {
      field('Trakt Client ID').props.onChangeText('second-id');
    });
    await act(async () => {
      await field('Trakt Client Secret').props.onSubmitEditing();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({client_id: 'second-id'});
    act(() => tree.unmount());
  });

  it('signs in to Simkl with the client ID just typed, also from its Go key', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    fetchMock.mockImplementation(() => json(200, {user_code: 'PIN1', verification_url: 'https://simkl.com/pin', interval: 5, expires_in: 900}));
    const tree = await render();
    const simkl = () => inputs(tree).find(input => input.props.accessibilityLabel === 'Simkl Client ID')!;
    await act(async () => {
      simkl().props.onChangeText('simkl-id');
    });
    await act(async () => {
      await simkl().props.onSubmitEditing();
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/oauth/pin?client_id=simkl-id');
    expect(sync.readSyncSettings().simkl.clientId).toBe('simkl-id');
    act(() => tree.unmount());
  });

  it('opens the AniList sign-in and checks the token with the client ID just typed', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const tree = await render();
    const field = (label: string) => inputs(tree).find(input => input.props.accessibilityLabel === label)!;
    await act(async () => {
      field('AniList Client ID').props.onChangeText('777');
    });
    // AniList has two Sign in chips' worth of services above it; its own is the last.
    const signIns = chip(tree, 'Sign in');
    await act(async () => {
      signIns[signIns.length - 1].props.onPress();
    });
    expect(openURL).toHaveBeenCalledWith('https://anilist.co/api/v2/oauth/authorize?client_id=777&response_type=token');
    expect(sync.readSyncSettings().anilist.clientId).toBe('777');

    // Check token saves a client ID typed after it too, and still checks before saving the token.
    await act(async () => {
      field('AniList Client ID').props.onChangeText('888');
      field('AniList Paste the AniList token').props.onChangeText('bad-token');
    });
    fetchMock.mockImplementationOnce(() => json(401, {errors: [{message: 'Invalid token', status: 401}]}));
    await act(async () => {
      await chip(tree, 'Check token')[0].props.onPress();
    });
    expect(sync.readSyncSettings().anilist.clientId).toBe('888');
    expect(sync.readSyncSettings().anilist.accessToken).toBeUndefined();
    act(() => tree.unmount());
  });

  it('saves a pasted AniList token only once AniList accepts it, also from the Done key', async () => {
    sync.updateAccount('anilist', {clientId: '123'});
    const token = jwt({sub: '42', exp: Math.floor(Date.now() / 1000) + 200 * 86400});
    const tree = await render();
    const tokenField = () => inputs(tree).find(input => input.props.accessibilityLabel === 'AniList Paste the AniList token')!;

    await act(async () => {
      tokenField().props.onChangeText(token);
    });
    expect(sync.readSyncSettings().anilist.accessToken).toBeUndefined();

    fetchMock.mockImplementationOnce(() => json(401, {errors: [{message: 'Invalid token', status: 401}]}));
    await act(async () => {
      await tokenField().props.onSubmitEditing();
    });
    expect(toast).toHaveBeenLastCalledWith(expect.stringMatching(/did not accept this token/));
    expect(sync.readSyncSettings().anilist.accessToken).toBeUndefined();

    fetchMock.mockImplementationOnce(() => json(200, {data: {Viewer: {name: 'reader'}}}));
    await act(async () => {
      await tokenField().props.onSubmitEditing();
    });
    expect(sync.readSyncSettings().anilist).toMatchObject({accessToken: token, username: 'reader', clientId: '123'});
    expect(toast).toHaveBeenLastCalledWith('AniList connected as reader');
    expect(texts(tree)).toEqual(expect.arrayContaining(['Connected as reader', expect.stringMatching(/^Signed in until /)]));
  });

  it('says why a sign-in ended, and that a live Trakt sign-in renews itself', async () => {
    sync.updateAccount('simkl', {clientId: 'sid', signedOutReason: 'Simkl ended your session. Sign in again.'});
    sync.updateAccount('trakt', {clientId: 'cid', clientSecret: 'secret', accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() + 20 * 3600_000, username: 'viewer'});
    const tree = await render();
    expect(texts(tree)).toEqual(expect.arrayContaining(['Simkl ended your session. Sign in again.', 'Connected as viewer', 'Renews automatically']));
    expect(chip(tree, 'Disconnect')).toHaveLength(1);
  });

  it('disconnects Trakt and asks Trakt to revoke the token', async () => {
    sync.updateAccount('trakt', {clientId: 'cid', clientSecret: 'secret', accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() + 20 * 3600_000, username: 'viewer'});
    fetchMock.mockImplementation(() => json(200, {}));
    const tree = await render();
    await act(async () => {
      chip(tree, 'Disconnect')[0].props.onPress();
    });
    expect(sync.readSyncSettings().trakt).toMatchObject({accessToken: '', refreshToken: '', clientId: 'cid'});
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://api.trakt.tv/oauth/revoke']);
    expect(texts(tree)).toContain('Not connected');
  });

  it('waits five seconds longer between checks each time Trakt asks it to slow down', async () => {
    jest.useFakeTimers();
    try {
      sync.updateAccount('trakt', {clientId: 'cid', clientSecret: 'secret'});
      jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      fetchMock.mockImplementation((url: string) =>
        url.endsWith('/oauth/device/code')
          ? json(200, {user_code: 'ABCD', verification_url: 'https://trakt.tv/activate', device_code: 'dev', interval: 5, expires_in: 600})
          : json(429, {}),
      );
      const polls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/oauth/device/token')).length;
      const tree = await render();
      await act(async () => {
        await chip(tree, 'Sign in')[0].props.onPress();
      });
      expect(texts(tree).some(line => line.includes('ABCD'))).toBe(true);

      await act(() => jest.advanceTimersByTimeAsync(5000));
      expect(polls()).toBe(1);
      await act(() => jest.advanceTimersByTimeAsync(9999));
      expect(polls()).toBe(1);
      await act(() => jest.advanceTimersByTimeAsync(1));
      expect(polls()).toBe(2);
      await act(() => jest.advanceTimersByTimeAsync(15000));
      expect(polls()).toBe(3);

      // Leaving the screen stops the polling.
      act(() => tree.unmount());
      await act(() => jest.advanceTimersByTimeAsync(60000));
      expect(polls()).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });
});

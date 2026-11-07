// The Sources form signs in to Plex with a plex.tv/link code and to Jellyfin
// with Quick Connect, and saves the source once approved. Fixtures only.
import React from 'react';
import {Text, TextInput, ToastAndroid} from 'react-native';
import renderer, {act} from 'react-test-renderer';
import Sources from '../src/screens/Sources';
import {deleteSource, getInstallId, listSources} from '../src/lib/sources/vault';
import {QUICK_CONNECT_OFF_MESSAGE} from '../src/lib/sources/quickConnect';

jest.mock('expo-crypto', () => ({randomUUID: () => 'install-a'}));
jest.mock('../src/components/ui/Text', () => {
  const {Text: RNText, TextInput: Input} = require('react-native');
  return {__esModule: true, default: RNText, RawText: RNText, RawTextInput: Input};
});
jest.mock('../src/components/ui/Button', () => {
  const {Pressable, Text: RNText} = require('react-native');
  return {
    __esModule: true,
    default: ({children, onPress, disabled, hasTVPreferredFocus}: any) => (
      <Pressable accessibilityRole="button" onPress={disabled ? undefined : onPress} hasTVPreferredFocus={hasTVPreferredFocus}>
        <RNText>{children}</RNText>
      </Pressable>
    ),
  };
});
jest.mock('../src/components/QrCode', () => 'QrCode');
jest.mock('../src/screens/Magnet', () => 'Magnet');
jest.mock('../src/components/tv', () => {
  const {createElement} = require('react');
  const {Pressable} = require('react-native');
  return {TVFocusable: ({children, ...props}: any) => createElement(Pressable, props, children)};
});
jest.mock('../src/lib/sources/smb', () => ({listSmbShare: jest.fn(async () => [])}));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));

const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});

const NOW = 1_700_000_000_000;

describe('Sources code sign-in', () => {
  let tree: renderer.ReactTestRenderer;
  let routes: Record<string, () => Promise<unknown>>;
  let fetchMock: jest.Mock;
  const navigation = {navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true, getState: () => ({index: 0}), setParams: jest.fn()};

  beforeEach(() => {
    jest.useFakeTimers({now: NOW});
    routes = {};
    fetchMock = jest.fn((url: string) => {
      const match = Object.keys(routes).find(prefix => url.startsWith(prefix));
      return match ? routes[match]() : json(404, {});
    });
    (globalThis as any).fetch = fetchMock;
    jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
    listSources().forEach(item => deleteSource(item.id));
  });

  afterEach(() => {
    act(() => tree.unmount());
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const render = async (params?: Record<string, unknown>) => {
    await act(async () => {
      tree = renderer.create(<Sources navigation={navigation} route={{params}} />);
    });
  };
  const advance = (ms: number) =>
    act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  const texts = () => tree.root.findAllByType(Text).map(node => [].concat(node.props.children).join(''));
  const button = (label: string) =>
    tree.root.findAll(
      node => typeof node.props.onPress === 'function' && node.props.accessibilityRole === 'button' && node.findAllByType(Text).some(text => text.props.children === label),
    )[0];
  const press = (label: string) =>
    act(async () => {
      await button(label).props.onPress();
    });
  const urls = () => fetchMock.mock.calls.map(call => call[0] as string);

  it('signs in to Plex with a plex.tv/link code and saves the address that answers', async () => {
    let approved = false;
    routes['https://plex.tv/api/v2/pins?'] = () => json(201, {id: 7, code: 'wxyz', expiresIn: 900});
    routes['https://plex.tv/api/v2/pins/7'] = () => json(200, {id: 7, authToken: approved ? 'acct-token' : null});
    routes['https://plex.tv/api/v2/resources'] = () =>
      json(200, [
        {
          name: 'Basement',
          provides: 'server',
          clientIdentifier: 'srv-1',
          owned: true,
          accessToken: 'srv-token',
          connections: [
            {protocol: 'https', uri: 'https://relay.plex.direct:8443', local: false, relay: true},
            {protocol: 'https', uri: 'https://10-0-0-5.abc.plex.direct:32400', local: true, relay: false},
          ],
        },
      ]);
    routes['https://10-0-0-5.abc.plex.direct:32400/identity'] = () => json(200, {});
    routes['https://relay.plex.direct:8443/identity'] = () => json(200, {});

    await render({kind: 'plex'});
    expect(texts()).toContain('Get a code');
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
    await press('Get a code');
    expect(texts()).toContain('WXYZ');
    expect(tree.root.findAll(node => (node.type as unknown) === 'QrCode')[0].props.value).toBe('https://plex.tv/link');

    // Pending: still waiting.
    await advance(2000);
    expect(texts()).toContain('Waiting for you to enter the code…');
    expect(listSources()).toEqual([]);

    approved = true;
    await advance(2000);
    expect(urls()).toEqual(expect.arrayContaining(['https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1']));
    expect(listSources()).toEqual([
      {
        // A new id when the sign-in finishes, two polls after the code.
        id: String(NOW + 4000),
        kind: 'plex',
        name: 'Basement',
        server: 'https://10-0-0-5.abc.plex.direct:32400',
        share: '',
        username: '',
        secret: 'srv-token',
        deviceId: getInstallId(),
        authState: 'ok',
      },
    ]);
    expect(ToastAndroid.show).toHaveBeenCalledWith('Source saved', ToastAndroid.SHORT);
  });

  it('lets the user pick a Plex server and shows when a code expires', async () => {
    routes['https://plex.tv/api/v2/pins?'] = () => json(201, {id: 8, code: 'abcd', expiresIn: 3});
    routes['https://plex.tv/api/v2/pins/8'] = () => json(200, {authToken: null});
    await render({kind: 'plex'});
    await press('Get a code');
    await advance(6000);
    expect(texts()).toContain('The code expired. Try again.');
    expect(texts()).toContain('Get a new code');

    routes['https://plex.tv/api/v2/pins?'] = () => json(201, {id: 9, code: 'efgh', expiresIn: 900});
    routes['https://plex.tv/api/v2/pins/9'] = () => json(200, {authToken: 'acct-token'});
    routes['https://plex.tv/api/v2/resources'] = () =>
      json(200, [
        {name: 'Mine', provides: 'server', clientIdentifier: 'a', owned: true, connections: [{protocol: 'http', uri: 'http://192.168.1.2:32400', local: true}]},
        {name: 'Friend', provides: 'server', clientIdentifier: 'b', owned: false, accessToken: 'friend-token', connections: [{protocol: 'https', uri: 'https://friend.plex.direct:32400'}]},
      ]);
    routes['https://friend.plex.direct:32400/identity'] = () => Promise.reject(new Error('timeout'));
    await press('Get a new code');
    await advance(2000);
    expect(texts()).toEqual(expect.arrayContaining(['Pick a server', 'Mine', 'Friend', 'Shared with you']));

    await act(async () => {
      await tree.root.findAll(node => node.props.accessibilityLabel === 'Use Friend' && typeof node.props.onPress === 'function')[0].props.onPress();
    });
    expect(texts()).toContain('Could not reach Friend. Check that it is on, or sign in with its address.');
    expect(listSources()).toEqual([]);

    await press('Pick another server');
    routes['http://192.168.1.2:32400/identity'] = () => json(200, {});
    await act(async () => {
      await tree.root.findAll(node => node.props.accessibilityLabel === 'Use Mine' && typeof node.props.onPress === 'function')[0].props.onPress();
    });
    expect(listSources()).toMatchObject([{kind: 'plex', name: 'Mine', server: 'http://192.168.1.2:32400', secret: 'acct-token'}]);
  });

  it('signs in to Jellyfin with Quick Connect', async () => {
    let approved = false;
    routes['https://jf.local/QuickConnect/Enabled'] = () => json(200, true);
    routes['https://jf.local/QuickConnect/Initiate'] = () => json(200, {Secret: 'sec-1', Code: '123456'});
    routes['https://jf.local/QuickConnect/Connect'] = () => json(200, {Authenticated: approved});
    routes['https://jf.local/Users/AuthenticateWithQuickConnect'] = () => json(200, {User: {Id: 'user-guid', Name: 'Ana'}, AccessToken: 'jf-token'});

    await render({kind: 'jellyfin'});
    // The server address comes first.
    await press('Use Quick Connect');
    expect(ToastAndroid.show).toHaveBeenCalledWith('Enter the server address', ToastAndroid.LONG);

    await act(async () => {
      tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'Server address')!.props.onChangeText(' https://jf.local/ ');
    });
    await press('Use Quick Connect');
    expect(texts()).toEqual(expect.arrayContaining(['Enter this code in Jellyfin:', '123456', 'Settings > Quick Connect, on a phone or computer that is signed in.']));
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);

    await advance(3000);
    expect(listSources()).toEqual([]);
    approved = true;
    await advance(3000);

    const deviceId = `${getInstallId()}-${NOW}`;
    const initiate = fetchMock.mock.calls.find(call => String(call[0]).endsWith('/QuickConnect/Initiate'))!;
    expect(initiate[1].headers.Authorization).toContain(`DeviceId="${deviceId}"`);
    expect(listSources()).toEqual([
      {id: String(NOW), kind: 'jellyfin', name: 'Jellyfin', server: 'https://jf.local', share: '', username: 'user-guid', secret: 'jf-token', loginName: 'Ana', deviceId, authState: 'ok'},
    ]);
  });

  it('says when Quick Connect is off and goes back to the password form', async () => {
    routes['https://jf.local/QuickConnect/Enabled'] = () => json(200, false);
    await render({kind: 'jellyfin', prefill: {server: 'https://jf.local'}});
    await press('Use Quick Connect');
    expect(texts()).toContain(QUICK_CONNECT_OFF_MESSAGE);
    await press('Use password instead');
    expect(tree.root.findAllByType(TextInput).map(node => node.props.accessibilityLabel)).toEqual(['Name', 'Server address', 'Username', 'Password']);
  });

  it('offers no Quick Connect for Emby', async () => {
    await render({kind: 'emby'});
    expect(texts()).not.toContain('Use Quick Connect');
    expect(texts()).toContain('Save');
  });
});

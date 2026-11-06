// Every sign-in can be submitted from the keyboard and stays reachable above it.
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {KeyboardAvoidingView, ScrollView, TextInput, ToastAndroid} from 'react-native';

const mockSignIn = jest.fn();
const mockSaveAccount = jest.fn();
const mockSaveSource = jest.fn();
const mockSignInJellyfin = jest.fn();

jest.mock('../src/components/ui/Text', () => {
  const {Text, TextInput: Input} = require('react-native');
  return {__esModule: true, default: Text, RawText: Text, RawTextInput: Input};
});
jest.mock('../src/components/ui/Button', () => {
  const {Pressable, Text} = require('react-native');
  return {
    __esModule: true,
    default: ({children, onPress, disabled}: any) => (
      <Pressable accessibilityRole="button" onPress={disabled ? undefined : onPress}>
        <Text>{children}</Text>
      </Pressable>
    ),
  };
});
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('@dr.pogodin/react-native-fs', () => ({}));
jest.mock('../src/lib/torrentManager', () => ({torrentManager: {}}));
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {isDirectTorrentWifiOnly: () => false, keepDirectTorrentFile: () => false},
}));
jest.mock('../src/lib/pikpak/client', () => ({
  signInToPikPak: (...args: unknown[]) => mockSignIn(...args),
  sessionFromToken: (token: string) => ({accessToken: token}),
  addMagnetTask: jest.fn(),
  readMagnetTask: jest.fn(),
  assertMagnet: (value: string) => value,
}));
jest.mock('../src/lib/pikpak/session', () => ({isPikPakAuthError: () => false, withPikPak: jest.fn()}));
jest.mock('../src/lib/sources/vault', () => ({
  readPikPakAccount: () => undefined,
  readPikPakUsername: () => '',
  savePikPakAccount: (...args: unknown[]) => mockSaveAccount(...args),
  clearPikPakAccount: jest.fn(),
  listSources: () => [],
  saveSource: (...args: unknown[]) => mockSaveSource(...args),
  deleteSource: jest.fn(),
}));
jest.mock('../src/lib/sources/mediaServers', () => ({
  signInJellyfin: (...args: unknown[]) => mockSignInJellyfin(...args),
  signInEmby: jest.fn(),
  signInPlex: jest.fn(),
  listJellyfin: jest.fn(),
  listEmby: jest.fn(),
  listPlex: jest.fn(),
}));
jest.mock('../src/lib/sources/smb', () => ({listSmbShare: jest.fn()}));
jest.mock('../src/lib/sources/webdav', () => ({listWebDav: jest.fn()}));

import KeyboardForm from '../src/components/ui/KeyboardForm';
import Magnet from '../src/screens/Magnet';
import Sources from '../src/screens/Sources';

const flush = () => act(async () => {
  await Promise.resolve();
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
});

it('pads for the keyboard and keeps taps working while it is open', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<KeyboardForm><TextInput /></KeyboardForm>);
  });
  expect(tree.root.findByType(KeyboardAvoidingView).props.behavior).toBe('padding');
  expect(tree.root.findByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
});

describe('PikPak sign-in', () => {
  const render = () => renderer.create(<Magnet navigation={{goBack: jest.fn()}} pikpakOnly />);
  const fields = (tree: renderer.ReactTestRenderer) => {
    const inputs = tree.root.findAllByType(TextInput);
    return {
      username: inputs.find(input => input.props.autoComplete === 'username')!,
      password: inputs.find(input => input.props.autoComplete === 'password')!,
      token: inputs.find(input => input.props.placeholder === 'Access token')!,
    };
  };

  it('signs in from the keyboard Go key on the password field', async () => {
    mockSignIn.mockResolvedValue({accessToken: 'a', refreshToken: 'r', expiresAt: 1, userId: 'u'});
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = render();
    });
    const {username, password} = fields(tree);
    expect(username.props.returnKeyType).toBe('next');
    expect(password.props.returnKeyType).toBe('go');
    await act(async () => {
      username.props.onChangeText('me@example.com');
      password.props.onChangeText('secret');
    });
    await act(async () => {
      await fields(tree).password.props.onSubmitEditing();
    });
    expect(mockSignIn).toHaveBeenCalledWith('me@example.com', 'secret');
    expect(mockSaveAccount).toHaveBeenCalledWith(expect.objectContaining({username: 'me@example.com', refreshToken: 'r'}));
  });

  it('asks for the missing details instead of sending an empty sign-in', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = render();
    });
    await act(async () => {
      await fields(tree).password.props.onSubmitEditing();
    });
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(ToastAndroid.show).toHaveBeenCalledWith(expect.stringMatching(/email and password/), expect.anything());
  });

  it('names every field for screen readers', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = render();
    });
    expect(tree.root.findAllByType(TextInput).map(input => input.props.accessibilityLabel)).toEqual([
      'Magnet link',
      'PikPak email or username',
      'PikPak password',
      'PikPak access token',
    ]);
  });

  it('keeps the whole form in a keyboard-aware scroll view', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = render();
    });
    expect(tree.root.findAllByType(KeyboardAvoidingView).length).toBeGreaterThan(0);
  });
});

describe('Add source', () => {
  const render = (kind: string) =>
    renderer.create(<Sources navigation={{navigate: jest.fn()}} route={{params: {kind}}} />);

  it('moves through the fields with Next and saves with Go on the last one', async () => {
    mockSignInJellyfin.mockResolvedValue({userId: 'user-1', token: 'tok'});
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = render('jellyfin');
    });
    await flush();
    const inputs = tree.root.findAllByType(TextInput);
    expect(inputs.map(input => input.props.accessibilityLabel)).toEqual(['Name', 'Server address', 'Username', 'Password']);
    expect(inputs.slice(0, -1).every(input => input.props.returnKeyType === 'next')).toBe(true);
    const last = inputs[inputs.length - 1];
    expect(last.props.returnKeyType).toBe('go');
    await act(async () => {
      inputs[1].props.onChangeText('http://192.168.1.10:8096');
      inputs[2].props.onChangeText('me');
      inputs[3].props.onChangeText('pw');
    });
    await act(async () => {
      await tree.root.findAllByType(TextInput)[3].props.onSubmitEditing();
    });
    expect(mockSignInJellyfin).toHaveBeenCalledWith('http://192.168.1.10:8096', 'me', 'pw');
    expect(mockSaveSource).toHaveBeenCalledWith(expect.objectContaining({kind: 'jellyfin', server: 'http://192.168.1.10:8096', username: 'user-1', secret: 'tok', name: 'Jellyfin'}));
  });

  it('returns to the screen it was opened from after Save and Cancel', async () => {
    mockSignInJellyfin.mockResolvedValue({userId: 'user-1', token: 'tok'});
    const navigation = {navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true};
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<Sources navigation={navigation} route={{params: {kind: 'jellyfin'}}} />);
    });
    const inputs = tree.root.findAllByType(TextInput);
    await act(async () => {
      inputs[1].props.onChangeText('http://192.168.1.10:8096');
    });
    await act(async () => {
      await tree.root.findAllByType(TextInput)[3].props.onSubmitEditing();
    });
    expect(mockSaveSource).toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);

    let cancelTree!: renderer.ReactTestRenderer;
    const cancelNav = {navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true};
    await act(async () => {
      cancelTree = renderer.create(<Sources navigation={cancelNav} route={{params: {kind: 'webdav'}}} />);
    });
    const cancel = cancelTree.root.findAll(node => node.props.accessibilityRole === 'button' && node.findAllByProps({children: 'Cancel'}).length > 0)[0];
    await act(async () => {
      cancel.props.onPress();
    });
    expect(cancelNav.goBack).toHaveBeenCalledTimes(1);
  });

  it('closes the PikPak sign-in back to where it was opened', async () => {
    const navigation = {navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true};
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<Sources navigation={navigation} route={{params: {kind: 'pikpak'}}} />);
    });
    const back = tree.root.findAll(node => typeof node.props.onPress === 'function' && node.findAllByProps({children: 'Back'}).length > 0)[0];
    await act(async () => {
      back.props.onPress();
    });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('shows the share field only for SMB', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = render('smb');
    });
    await flush();
    const labels = tree.root.findAllByType(TextInput).map(input => input.props.accessibilityLabel);
    expect(labels).toEqual(['Name', 'Server', 'Username', 'Password', 'Share name']);
  });

  it('does not save without a server address', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = render('webdav');
    });
    await flush();
    const inputs = tree.root.findAllByType(TextInput);
    await act(async () => {
      await inputs[inputs.length - 1].props.onSubmitEditing();
    });
    expect(mockSaveSource).not.toHaveBeenCalled();
    expect(ToastAndroid.show).toHaveBeenCalledWith('Enter the server address', expect.anything());
  });
});

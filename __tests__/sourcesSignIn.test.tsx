// The Sources screen: an ended sign-in marks the source and opens the
// full-screen sign-in form prefilled under the same id; editing keeps the
// sign-in; deleting asks first; WebDAV plays with its saved sign-in.
import React from 'react';
import {BackHandler, KeyboardAvoidingView, Text, TextInput, ToastAndroid} from 'react-native';
import renderer, {act} from 'react-test-renderer';
import Sources from '../src/screens/Sources';
import useAppDialogStore from '../src/lib/zustand/appDialogStore';
import {deleteSource, getInstallId, listSources, saveSource, type SavedSource} from '../src/lib/sources/vault';

jest.mock('expo-crypto', () => ({randomUUID: () => 'install-a'}));
jest.mock('../src/components/ui/Text', () => {
  const {Text: RNText, TextInput: Input} = require('react-native');
  return {__esModule: true, default: RNText, RawText: RNText, RawTextInput: Input};
});
jest.mock('../src/components/ui/Button', () => {
  const {Pressable, Text: RNText} = require('react-native');
  return {
    __esModule: true,
    default: ({children, onPress, disabled}: any) => (
      <Pressable accessibilityRole="button" onPress={disabled ? undefined : onPress}>
        <RNText>{children}</RNText>
      </Pressable>
    ),
  };
});
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
const xml = (status: number, body: string) => Promise.resolve({ok: status >= 200 && status < 300, status, text: async () => body});

// Saved before 5.5.0: no deviceId, so its token belongs to the old shared id.
const jellyfin: SavedSource = {id: 's1', kind: 'jellyfin', name: 'Home', server: 'https://jf.local', username: 'user-guid', secret: 'old', loginName: 'me'};
const webdav: SavedSource = {id: 'w1', kind: 'webdav', name: 'NAS', server: 'https://dav.local/dav/', username: 'me', secret: 'pw'};

const PROPFIND = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
<d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/dav/clip.mkv</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>10</d:getcontentlength></d:prop></d:propstat></d:response>
</d:multistatus>`;

describe('Sources sign-in', () => {
  let fetchMock: jest.Mock;
  let navigation: {navigate: jest.Mock; goBack: jest.Mock; canGoBack: () => boolean};
  let tree: renderer.ReactTestRenderer;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
    navigation = {navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true};
    jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
    useAppDialogStore.getState().dismissDialog();
    listSources().forEach(item => deleteSource(item.id));
  });

  afterEach(() => {
    act(() => tree.unmount());
    jest.restoreAllMocks();
  });

  const flush = () =>
    act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

  const render = async (params?: {openId?: string; kind?: string}) => {
    await act(async () => {
      tree = renderer.create(<Sources navigation={navigation} route={{params}} />);
    });
    await flush();
  };

  const texts = () => tree.root.findAllByType(Text).map(node => [].concat(node.props.children).join(''));
  const input = (label: string) => tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label)!;
  const pressable = (match: (node: renderer.ReactTestInstance) => boolean) =>
    tree.root.findAll(node => typeof node.props.onPress === 'function' && match(node))[0];
  const button = (label: string) =>
    pressable(node => node.props.accessibilityRole === 'button' && node.findAllByType(Text).some(text => text.props.children === label));

  it('opens a prefilled full-screen sign-in when the server ends the sign-in, and keeps the id', async () => {
    saveSource(jellyfin);
    fetchMock.mockReturnValueOnce(json(401, {}));
    await render({openId: 's1'});

    expect(listSources()).toEqual([{...jellyfin, authState: 'signedOut'}]);
    expect(tree.root.findAllByType(KeyboardAvoidingView).length).toBeGreaterThan(0);
    expect(texts()).toEqual(expect.arrayContaining(['Sign in to Home again', 'Home: Jellyfin ended this sign-in. Sign in again.']));
    expect(input('Server address').props.value).toBe('https://jf.local');
    expect(input('Username').props.value).toBe('me');
    expect(input('Password').props.value).toBe('');
    expect(input('Password').props.autoFocus).toBe(true);
    // The kind cannot change while signing a saved source in again.
    expect(tree.root.findAll(node => node.props.accessibilityState?.selected !== undefined)).toHaveLength(0);

    await act(async () => {
      input('Password').props.onChangeText('pw');
    });
    fetchMock.mockReturnValueOnce(json(200, {User: {Id: 'user-guid'}, AccessToken: 'fresh'}));
    fetchMock.mockReturnValueOnce(json(200, {Items: [{Id: 'm1', Name: 'Film', Type: 'Movie'}]}));
    await act(async () => {
      await input('Password').props.onSubmitEditing();
    });
    await flush();

    // A new DeviceId: reusing the shared 'droid-stream' would end other installs' sign-ins.
    const deviceId = `${getInstallId()}-s1`;
    const [signInUrl, signIn] = fetchMock.mock.calls[1];
    expect(signInUrl).toBe('https://jf.local/Users/AuthenticateByName');
    expect(signIn.headers.Authorization).toContain(`DeviceId="${deviceId}"`);
    expect(JSON.parse(signIn.body)).toEqual({Username: 'me', Pw: 'pw'});
    expect(listSources()).toEqual([
      {id: 's1', kind: 'jellyfin', name: 'Home', server: 'https://jf.local', share: '', username: 'user-guid', secret: 'fresh', loginName: 'me', deviceId, authState: 'ok'},
    ]);
    expect(ToastAndroid.show).toHaveBeenCalledWith('Signed in again', ToastAndroid.SHORT);

    // It carries on into the source with the new sign-in.
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toContain(`DeviceId="${deviceId}", Version="1.0", Token="fresh"`);
    expect(texts()).toContain('Film');
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('keeps the toast and the saved state for other errors', async () => {
    saveSource(jellyfin);
    fetchMock.mockReturnValueOnce(json(500, {}));
    await render({openId: 's1'});
    expect(ToastAndroid.show).toHaveBeenCalledWith('Jellyfin library failed (500)', ToastAndroid.LONG);
    expect(listSources()).toEqual([jellyfin]);
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  });

  it('keeps the saved source as it was when signing in again fails', async () => {
    saveSource(jellyfin);
    fetchMock.mockReturnValueOnce(json(401, {}));
    await render({openId: 's1'});
    fetchMock.mockReturnValueOnce(json(401, {}));
    await act(async () => {
      input('Password').props.onChangeText('wrong');
    });
    await act(async () => {
      await input('Password').props.onSubmitEditing();
    });
    expect(ToastAndroid.show).toHaveBeenCalledWith('Jellyfin did not accept this username or password.', ToastAndroid.LONG);
    expect(listSources()).toEqual([{...jellyfin, authState: 'signedOut'}]);
    expect(input('Password')).toBeDefined();
  });

  it('marks a signed-out source in the list and clears the mark once its sign-in works again', async () => {
    saveSource({...webdav, authState: 'signedOut'});
    await render();
    expect(texts()).toContain('webdav · https://dav.local/dav/ · signed out');
    expect(pressable(node => node.props.accessibilityLabel === 'Sign in to NAS again')).toBeDefined();

    fetchMock.mockReturnValueOnce(xml(207, PROPFIND));
    await act(async () => {
      await pressable(node => typeof node.props.onLongPress === 'function').props.onPress();
    });
    await flush();
    expect(listSources()[0].authState).toBe('ok');
    expect(texts()).toContain('clip.mkv');
  });

  it('edits a source without signing in again when the password stays empty', async () => {
    saveSource(webdav);
    saveSource(jellyfin);
    await render();
    await act(async () => {
      pressable(node => node.props.accessibilityLabel === 'Edit NAS').props.onPress();
    });
    expect(texts()).toContain('Edit NAS');
    expect(input('Password').props.placeholder).toBe('Leave empty to keep the current sign-in');
    expect(input('Username').props.value).toBe('me');

    await act(async () => {
      input('Name').props.onChangeText('Attic NAS');
    });
    await act(async () => {
      await button('Save').props.onPress();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(listSources()).toEqual([{...webdav, name: 'Attic NAS', share: ''}, jellyfin]);

    // A new source starts empty, not with the details of a cancelled edit.
    await act(async () => {
      pressable(node => node.props.accessibilityLabel === 'Edit Home').props.onPress();
    });
    expect(input('Username').props.value).toBe('me');
    await act(async () => {
      button('Cancel').props.onPress();
    });
    await act(async () => {
      pressable(node => node.findAllByType(Text).some(text => text.props.children === 'Add source')).props.onPress();
    });
    expect(texts()).toContain('Add source');
    expect(input('Name').props.value).toBe('');
    expect(input('Server address').props.value).toBe('');
  });

  it('asks before deleting a source on long press', async () => {
    saveSource(jellyfin);
    await render();
    act(() => {
      pressable(node => typeof node.props.onLongPress === 'function').props.onLongPress();
    });
    const dialog = useAppDialogStore.getState().dialog!;
    expect(dialog.title).toBe('Delete Home?');
    expect(listSources()).toHaveLength(1);
    act(() => {
      dialog.actions!.find(action => action.label === 'Delete')!.onPress!();
    });
    expect(listSources()).toHaveLength(0);
  });

  describe('leaving the form', () => {
    const RETURN_TO = {tab: 'TorrentsStack', screen: 'DebridSettings'};
    let nav: {navigate: jest.Mock; goBack: jest.Mock; canGoBack: () => boolean; getState: () => {index: number}; setParams: jest.Mock; isFocused: () => boolean};
    let stackIndex: number;

    beforeEach(() => {
      stackIndex = 0;
      nav = {navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true, getState: () => ({index: stackIndex}), setParams: jest.fn(), isFocused: () => true};
    });

    const renderWith = async (params?: Record<string, unknown>) => {
      await act(async () => {
        tree = renderer.create(<Sources navigation={nav} route={{params}} />);
      });
      await flush();
    };

    it('stays in the Library tab when only the tab navigator could go back', async () => {
      await renderWith({kind: 'jellyfin'});
      await act(async () => {
        button('Cancel').props.onPress();
      });
      expect(nav.goBack).not.toHaveBeenCalled();
      expect(texts()).toContain('Sources');
      expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
      expect(nav.setParams).toHaveBeenCalledWith({kind: undefined, openId: undefined, returnTo: undefined});
    });

    it('goes back when the Library stack has a screen below Sources', async () => {
      stackIndex = 1;
      await renderWith({kind: 'jellyfin'});
      await act(async () => {
        button('Cancel').props.onPress();
      });
      expect(nav.goBack).toHaveBeenCalledTimes(1);
    });

    it('returns to Debrid and cloud after a PikPak sign-in opened from the Torrents tab', async () => {
      stackIndex = 1;
      let onBack: (() => boolean | null | undefined) | undefined;
      jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
        onBack = handler;
        return {remove: jest.fn()};
      });
      await renderWith({kind: 'pikpak', returnTo: RETURN_TO});
      const magnet = () => tree.root.findAll(node => (node.type as unknown) === 'Magnet');
      expect(magnet()).toHaveLength(1);
      act(() => magnet()[0].props.onClose());
      expect(nav.navigate).toHaveBeenCalledWith('TorrentsStack', {screen: 'DebridSettings'});
      expect(nav.goBack).not.toHaveBeenCalled();
      // The Library tab shows the list next time instead of the PikPak form.
      expect(magnet()).toHaveLength(0);
      expect(nav.setParams).toHaveBeenCalledWith({kind: undefined, openId: undefined, returnTo: undefined});

      // Android Back does the same.
      act(() => tree.unmount());
      nav.navigate.mockClear();
      await renderWith({kind: 'pikpak', returnTo: RETURN_TO});
      let handled: boolean | null | undefined;
      act(() => {
        handled = onBack!();
      });
      expect(handled).toBe(true);
      expect(nav.navigate).toHaveBeenCalledWith('TorrentsStack', {screen: 'DebridSettings'});
      expect(nav.goBack).not.toHaveBeenCalled();
    });

    it('opens what new params ask for while the screen stays mounted', async () => {
      await renderWith();
      expect(texts()).toContain('Sources');
      await act(async () => {
        tree.update(<Sources navigation={nav} route={{params: {kind: 'plex'}}} />);
      });
      expect(input('Server address').props.placeholder).toBe('http://192.168.1.10:32400');
      await act(async () => {
        tree.update(<Sources navigation={nav} route={{params: {kind: 'pikpak', returnTo: RETURN_TO}}} />);
      });
      expect(tree.root.findAll(node => (node.type as unknown) === 'Magnet')).toHaveLength(1);
    });

    it('saves nothing when Cancel or leaving the screen comes while signing in, and signs in to the trimmed server', async () => {
      stackIndex = 1;
      const pending: Array<(value: unknown) => void> = [];
      fetchMock.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
      const fill = async () => {
        await act(async () => {
          input('Server address').props.onChangeText('  https://jf.local  ');
          input('Username').props.onChangeText('me');
          input('Password').props.onChangeText('pw');
        });
      };

      await renderWith({kind: 'jellyfin'});
      await fill();
      let saving!: Promise<void>;
      await act(async () => {
        saving = button('Save').props.onPress();
      });
      expect(texts()).toContain('Signing in…');
      expect(fetchMock.mock.calls[0][0]).toBe('https://jf.local/Users/AuthenticateByName');
      await act(async () => {
        button('Cancel').props.onPress();
      });
      expect(nav.goBack).toHaveBeenCalledTimes(1);
      await act(async () => {
        pending[0](await json(200, {User: {Id: 'user-guid'}, AccessToken: 'late'}));
        await saving;
      });
      expect(listSources()).toEqual([]);
      expect(ToastAndroid.show).not.toHaveBeenCalledWith('Source saved', ToastAndroid.SHORT);

      act(() => tree.unmount());
      await renderWith({kind: 'jellyfin'});
      await fill();
      await act(async () => {
        saving = button('Save').props.onPress();
      });
      act(() => tree.unmount());
      await act(async () => {
        pending[1](await json(200, {User: {Id: 'user-guid'}, AccessToken: 'late'}));
        await saving;
      });
      expect(listSources()).toEqual([]);
      // afterEach unmounts again; give it a fresh tree.
      await renderWith();
    });

    it('starts the next new source empty after Save and after Cancel', async () => {
      await renderWith();
      const addSource = () => pressable(node => node.findAllByType(Text).some(text => text.props.children === 'Add source'));
      const selectedKind = () => tree.root.findAll(node => node.props.accessibilityState?.selected === true && typeof node.props.onPress === 'function')[0].props.accessibilityLabel;
      await act(async () => {
        addSource().props.onPress();
      });
      await act(async () => {
        pressable(node => node.props.accessibilityLabel === 'SMB').props.onPress();
      });
      await act(async () => {
        input('Name').props.onChangeText('Den');
        input('Server').props.onChangeText('192.168.1.2');
      });
      await act(async () => {
        button('Cancel').props.onPress();
      });
      await act(async () => {
        addSource().props.onPress();
      });
      expect(selectedKind()).toBe('WebDAV');
      expect(input('Name').props.value).toBe('');
      expect(input('Server address').props.value).toBe('');

      await act(async () => {
        input('Name').props.onChangeText('Attic');
        input('Server address').props.onChangeText(' https://dav.local/dav/ ');
        input('Username').props.onChangeText('me');
      });
      await act(async () => {
        await button('Save').props.onPress();
      });
      expect(listSources()).toEqual([expect.objectContaining({kind: 'webdav', name: 'Attic', server: 'https://dav.local/dav/', username: 'me'})]);
      await act(async () => {
        addSource().props.onPress();
      });
      expect(['Name', 'Server address', 'Username', 'Password'].map(label => input(label).props.value)).toEqual(['', '', '', '']);
    });
  });

  it('plays WebDAV files with the saved Basic sign-in', async () => {
    saveSource(webdav);
    fetchMock.mockReturnValueOnce(xml(207, PROPFIND));
    await render({openId: 'w1'});
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Basic ${Buffer.from('me:pw').toString('base64')}`);
    await act(async () => {
      pressable(node => node.findAllByType(Text).some(text => text.props.children === 'clip.mkv')).props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith(
      'Player',
      expect.objectContaining({
        directUrl: 'https://dav.local/dav/clip.mkv',
        initialStream: {
          server: 'Source',
          link: 'https://dav.local/dav/clip.mkv',
          type: 'mkv',
          headers: {Authorization: `Basic ${Buffer.from('me:pw').toString('base64')}`},
        },
      }),
    );
  });
});

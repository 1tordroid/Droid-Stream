// Android TV: the Sources form can be reached and used with the D-pad alone.
import React from 'react';
import {Text, TextInput} from 'react-native';
import renderer, {act} from 'react-test-renderer';

jest.mock('../src/lib/tv/constants', () => ({...jest.requireActual('../src/lib/tv/constants'), isTV: true}));
jest.mock('expo-crypto', () => ({randomUUID: () => 'install-a'}));
jest.mock('../src/components/ui/Text', () => {
  const {Text: RNText, TextInput: Input} = require('react-native');
  return {__esModule: true, default: RNText, RawText: RNText, RawTextInput: Input};
});
jest.mock('../src/components/ui/Button', () => {
  const {Pressable, Text: RNText} = require('react-native');
  return {
    __esModule: true,
    default: ({children, onPress}: any) => (
      <Pressable accessibilityRole="button" onPress={onPress}>
        <RNText>{children}</RNText>
      </Pressable>
    ),
  };
});
jest.mock('../src/components/tv', () => ({TVFocusable: 'TVFocusable'}));
jest.mock('../src/screens/Magnet', () => 'Magnet');
jest.mock('../src/lib/sources/smb', () => ({listSmbShare: jest.fn(async () => [])}));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));

import Sources from '../src/screens/Sources';
import {deleteSource, listSources, saveSource} from '../src/lib/sources/vault';

describe('Sources on TV', () => {
  let tree: renderer.ReactTestRenderer;
  const navigation = {navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true, getState: () => ({index: 1}), setParams: jest.fn()};

  beforeEach(() => listSources().forEach(item => deleteSource(item.id)));
  afterEach(() => act(() => tree.unmount()));

  const render = async (params?: Record<string, unknown>) => {
    await act(async () => {
      tree = renderer.create(<Sources navigation={navigation} route={{params}} />);
    });
  };
  const chips = () => tree.root.findAll(node => (node.type as unknown) === 'TVFocusable');

  it('makes the kind chips focusable with a focus ring and starts on the selected one', async () => {
    await render({kind: 'emby'});
    expect(chips().map(chip => chip.props.accessibilityLabel)).toEqual(['WebDAV', 'SMB', 'Jellyfin', 'Emby', 'Plex']);
    expect(chips().filter(chip => chip.props.hasTVPreferredFocus).map(chip => chip.props.accessibilityLabel)).toEqual(['Emby']);
    expect(chips().every(chip => chip.props.borderRadius === 18)).toBe(true);
  });

  it('keeps D-pad focus on the last field after Go', async () => {
    await render({kind: 'jellyfin'});
    const inputs = tree.root.findAllByType(TextInput);
    const last = inputs[inputs.length - 1];
    expect(last.props.returnKeyType).toBe('go');
    expect(last.props.submitBehavior).toBe('submit');
    expect(inputs.every(input => input.props.submitBehavior === 'submit')).toBe(true);
  });

  it('starts an edit, which has no chips, on its first field', async () => {
    saveSource({id: 'w1', kind: 'webdav', name: 'NAS', server: 'https://dav.local/dav/', username: 'me', secret: 'pw'});
    await render();
    await act(async () => {
      tree.root.findAll(node => node.props.accessibilityLabel === 'Edit NAS' && typeof node.props.onPress === 'function')[0].props.onPress();
    });
    expect(tree.root.findAllByType(Text).some(node => node.props.children === 'Edit NAS')).toBe(true);
    expect(chips()).toHaveLength(0);
    const inputs = tree.root.findAllByType(TextInput);
    expect(inputs[0].props.accessibilityLabel).toBe('Name');
    expect(inputs.map(input => Boolean(input.props.autoFocus))).toEqual([true, false, false, false]);
  });
});

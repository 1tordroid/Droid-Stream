// Advanced downloads > Testing: the SMB playback switch, off by default.
import React from 'react';
import renderer, {act} from 'react-test-renderer';

// The remote control sections pull in notifications; this test only covers the Testing section.
jest.mock('../src/screens/settings/RemoteAccessSections', () => ({RemoteControlSection: () => null, CommandAccessSection: () => null, BrowserLikeSection: () => null}));
jest.mock('../src/components/ui/Button', () => 'Button');
jest.mock('../src/components/ui/IconButton', () => 'IconButton');
jest.mock('../src/components/ui/SettingsPage', () => ({children}: any) => children);
jest.mock('../src/components/ui/Text', () => {
  const {Text, TextInput} = require('react-native');
  return {__esModule: true, default: Text, RawTextInput: TextInput};
});
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('../src/components/ui/SettingsSection', () => ({children}: any) => children);
jest.mock('../src/components/ui/SettingsSwitchRow', () => (props: any) => {
  const {Switch} = require('react-native');
  return require('react').createElement(Switch, {accessibilityLabel: props.title, value: props.value, onValueChange: props.onValueChange});
});

import {ADVANCED_DOWNLOAD_SECTIONS} from '../src/screens/settings/AdvancedDownloads';
import {isSmbPlaybackTesting, setSmbPlaybackTesting} from '../src/lib/sources/smb';

it('turns SMB playback testing on and off', () => {
  setSmbPlaybackTesting(false);
  const Testing = ADVANCED_DOWNLOAD_SECTIONS.find(section => section.key === 'testing')!.Component;
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<Testing />);
  });
  const toggle = () => tree.root.find(node => node.props.accessibilityLabel === 'Try SMB playback (testing)' && node.props.onValueChange);
  expect(toggle().props.value).toBe(false);
  act(() => toggle().props.onValueChange(true));
  expect(isSmbPlaybackTesting()).toBe(true);
  expect(toggle().props.value).toBe(true);
  act(() => toggle().props.onValueChange(false));
  expect(isSmbPlaybackTesting()).toBe(false);
  act(() => tree.unmount());
});

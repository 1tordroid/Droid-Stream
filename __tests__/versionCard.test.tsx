// The version card at the top of Settings: name, version and a manual update check.
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';

const mockExtra: {appEdition?: string; isPlayStore?: boolean} = {};
jest.mock('expo-application', () => ({nativeApplicationVersion: '5.6.0', nativeBuildVersion: '222'}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return {extra: mockExtra};
    },
  },
}));
jest.mock('../src/components/ui/Text', () => require('react-native').Text);
jest.mock('../src/components/ui/LoadingIndicator', () => 'Loading');
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/components/tv', () => ({TVFocusable: 'FocusButton'}));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('../src/lib/storage', () => ({settingsStorage: {isAutoDownloadEnabled: () => false}}));
jest.mock('../src/lib/updates/checkForUpdate', () => ({checkForUpdate: jest.fn()}));

import VersionCard from '../src/screens/settings/components/VersionCard';
import {checkForUpdate} from '../src/lib/updates/checkForUpdate';

const textOf = (node: renderer.ReactTestInstance): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');

const render = () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<VersionCard />);
  });
  return tree;
};

beforeEach(() => {
  jest.clearAllMocks();
  delete mockExtra.isPlayStore;
  mockExtra.appEdition = 'tv';
});

it('shows the edition name with versionName and versionCode, and checks for updates by hand', () => {
  const tree = render();
  const lines = tree.root.findAllByType(Text).map(textOf);
  expect(lines).toContain('Droid Stream TV 5.6.0 (222)');
  const button = tree.root.findByProps({accessibilityLabel: 'Check for updates'});
  act(() => button.props.onPress());
  expect(checkForUpdate).toHaveBeenCalledWith(expect.any(Function), false, true);

  // The loading state from checkForUpdate disables the button and says so.
  const setLoading = (checkForUpdate as jest.Mock).mock.calls[0][0];
  act(() => setLoading(true));
  expect(tree.root.findByProps({accessibilityLabel: 'Check for updates'}).props.disabled).toBe(true);
  expect(tree.root.findAllByType(Text).map(textOf)).toContain('Checking');
  act(() => tree.unmount());
});

it('leaves the update check out of Play Store builds', () => {
  mockExtra.isPlayStore = true;
  const tree = render();
  expect(tree.root.findAll(node => node.props.accessibilityLabel === 'Check for updates')).toHaveLength(0);
  act(() => tree.unmount());
});

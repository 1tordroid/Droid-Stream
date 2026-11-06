import React from 'react';
import renderer, {act} from 'react-test-renderer';

const mockCalls: string[] = [];
const mockShowAppDialog = jest.fn();

jest.mock('expo', () => ({
  reloadAppAsync: jest.fn(async () => {
    mockCalls.push('reloadAppAsync');
  }),
}));
jest.mock('../src/lib/storage', () => ({
  clearAllMMKVStorage: jest.fn(() => mockCalls.push('clearAllMMKVStorage')),
  settingsStorage: {
    isSyncEnabled: () => false,
    isHapticFeedbackEnabled: () => false,
    setSyncEnabled: jest.fn(),
  },
}));
jest.mock('../src/lib/storage/secureStores', () => ({
  clearSignInStores: jest.fn(() => mockCalls.push('clearSignInStores')),
}));
jest.mock('../src/lib/zustand/appDialogStore', () => ({
  showAppDialog: (...args: unknown[]) => mockShowAppDialog(...args),
}));
jest.mock('../src/lib/backup', () => ({}));
jest.mock('../src/lib/clearAppCache', () => ({clearAppCache: jest.fn()}));
jest.mock('../src/lib/sync/syncService', () => ({
  clearSyncedWatchProgress: jest.fn(),
  syncFromSharedFolder: jest.fn(),
}));
jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('@react-navigation/native', () => ({useFocusEffect: jest.fn()}));
jest.mock('react-native-haptic-feedback', () => ({trigger: jest.fn()}));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/components/BackupExportDialog', () => () => null);
jest.mock('../src/components/tv', () => {
  const {View} = require('react-native');
  return {TVFocusable: View, TVFocusGuide: View};
});
jest.mock('../src/components/ui/Text', () => require('react-native').Text);
jest.mock('../src/components/ui/SettingsPage', () => ({children}: any) => children);
jest.mock('../src/components/ui/SettingsSection', () => ({children}: any) => children);
jest.mock('../src/components/ui/SettingsSwitchRow', () => () => null);
jest.mock('../src/components/ui/SettingsRow', () => (props: any) =>
  require('react').createElement('SettingsRow', props),
);

import DataManagement from '../src/screens/settings/DataManagement';

it('names saved sign-ins and erases them with every other store before restarting', async () => {
  let tree!: renderer.ReactTestRenderer;
  const navigation = {canGoBack: () => true, goBack: jest.fn()};
  act(() => {
    tree = renderer.create(<DataManagement navigation={navigation as any} route={{} as any} />);
  });
  const row = tree.root.find(node => node.type === ('SettingsRow' as any) && node.props.title === 'Erase all local data');
  expect(row.props.description).toContain('saved sign-ins');

  act(() => row.props.onPress());
  expect(mockShowAppDialog).toHaveBeenCalledTimes(1);
  const dialog = mockShowAppDialog.mock.calls[0][0];
  expect(dialog.message).toContain('saved sign-ins (Sources, PikPak, debrid, watch sync');
  expect(dialog.message).toContain('sign in again');

  const erase = dialog.actions.find((action: any) => action.variant === 'destructive');
  await act(async () => {
    await erase.onPress();
  });
  expect(mockCalls).toEqual(['clearAllMMKVStorage', 'clearSignInStores', 'reloadAppAsync']);
  act(() => tree.unmount());
});

import React from 'react';
import renderer, {act} from 'react-test-renderer';
import GenreChips from '../src/components/GenreChips';

const mockNavigate = jest.fn();
const mockGetGenres = jest.fn();

jest.mock('nativewind/jsx-runtime', () => require('react/jsx-runtime'));
jest.mock('@react-navigation/native', () => ({useNavigation: () => ({navigate: mockNavigate})}));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('../src/components/tv', () => ({
  TVFocusable: ({children, onPress, accessibilityLabel}: any) => {
    const {Pressable} = require('react-native');
    return <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress}>{children}</Pressable>;
  },
}));
jest.mock('../src/components/ui/Text', () => ({children}: any) => {
  const {Text} = require('react-native');
  return <Text>{children}</Text>;
});
jest.mock('../src/lib/services/ProviderManager', () => ({
  providerManager: {getGenres: (...args: unknown[]) => mockGetGenres(...args)},
}));
jest.mock('../src/lib/zustand/contentStore', () => (selector: any) =>
  selector({provider: {value: 'demo', display_name: 'Demo'}}),
);

it('shows the provider genres and opens one as a list', async () => {
  mockGetGenres.mockResolvedValue([
    {title: 'Action', filter: '/genre/action'},
    {title: 'Drama', filter: '/genre/drama'},
  ]);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<GenreChips />);
  });
  expect(mockGetGenres).toHaveBeenCalledWith({providerValue: 'demo'});
  const chip = tree.root.findByProps({accessibilityLabel: 'Browse Drama'});
  act(() => chip.props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('ScrollList', {
    title: 'Drama',
    filter: '/genre/drama',
    providerValue: 'demo',
    isSearch: false,
  });
});

it('renders nothing when the provider has no genres', async () => {
  mockGetGenres.mockResolvedValue([]);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<GenreChips />);
  });
  expect(tree.toJSON()).toBeNull();
});

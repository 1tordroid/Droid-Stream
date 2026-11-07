// Live TV layout: the quality tag sits on the group line (not on the logo),
// the Indian source has a short chip name, and the selected chip scrolls into view.
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Text, ToastAndroid} from 'react-native';

jest.mock('../src/components/ui/Text', () => {
  const {Text: NativeText, TextInput: Input} = require('react-native');
  return {__esModule: true, default: NativeText, RawText: NativeText, RawTextInput: Input};
});
jest.mock('../src/components/torrentSearch/Chip', () => {
  const {Pressable, Text: NativeText} = require('react-native');
  return {
    __esModule: true,
    default: ({label, onPress, accessibilityLabel}: any) => (
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} onPress={onPress}>
        <NativeText>{label}</NativeText>
      </Pressable>
    ),
  };
});
jest.mock('../src/components/ui/Button', () => {
  const {Pressable, Text: NativeText} = require('react-native');
  return {__esModule: true, default: ({children, onPress, accessibilityLabel}: any) => (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress}><NativeText>{children}</NativeText></Pressable>
  )};
});
jest.mock('react-native-reanimated', () => require('../__mocks__/reanimatedStub'));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));

import LiveTV from '../src/screens/livetv/LiveTV';
import {scrollOffsetToShow, sourceChipLabel, useSelectedChipScroll} from '../src/screens/livetv/chipScroll';

const M3U = `#EXTM3U
#EXTINF:-1 tvg-id="ndtv" tvg-logo="https://logo.example/ndtv.png" group-title="News",NDTV 24x7 (1080p)
https://s.example/ndtv.m3u8
`;

const textOf = (node: renderer.ReactTestInstance): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');

it('puts the quality tag at the end of the group line, outside the logo', async () => {
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  (global as any).fetch = jest.fn().mockResolvedValue({ok: true, status: 200, text: async () => M3U});
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<LiveTV navigation={{navigate: jest.fn()}} />);
  });
  const badges = tree.root.findAll(node => node.props.testID === 'quality-badge' && typeof node.type === 'string');
  expect(badges).toHaveLength(1);
  expect(textOf(badges[0])).toBe('1080p');

  // The badge shares a row with the group name.
  let row = badges[0].parent!;
  while (typeof row.type !== 'string') row = row.parent!;
  expect(row.props.style).toEqual(expect.objectContaining({flexDirection: 'row'}));
  expect(row.findAllByType(Text).map(textOf)).toEqual(['News', '1080p']);

  // The logo box (the one holding the Image) has no badge in it.
  const image = tree.root.findAll(node => node.props.source?.uri === 'https://logo.example/ndtv.png')[0];
  let logoBox = image.parent!;
  while (typeof logoBox.type !== 'string' || logoBox.props.style?.height === undefined) logoBox = logoBox.parent!;
  expect(logoBox.findAll(node => node.props.testID === 'quality-badge')).toHaveLength(0);
});

it('shows the Indian source as "India" and keeps the full name for screen readers', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<LiveTV navigation={{navigate: jest.fn()}} />);
  });
  const chip = tree.root.findAll(node => node.props.accessibilityLabel === 'Free Indian channels' && typeof node.props.onPress === 'function')[0];
  expect(chip.findAllByType(Text).map(textOf)).toEqual(['India']);
  expect(sourceChipLabel({kind: 'm3u', name: 'My playlist'})).toBe('My playlist');
});

describe('scrollOffsetToShow', () => {
  const view = {offset: 0, width: 360};
  it('leaves a chip that is already in view', () => {
    expect(scrollOffsetToShow({x: 100, width: 120}, view)).toBeNull();
  });
  it('scrolls a chip cut off at the right edge fully into view', () => {
    expect(scrollOffsetToShow({x: 300, width: 160}, view)).toBe(300 + 160 + 16 - 360);
  });
  it('scrolls back for a chip off the left edge', () => {
    expect(scrollOffsetToShow({x: 40, width: 100}, {offset: 200, width: 360})).toBe(24);
    expect(scrollOffsetToShow({x: 8, width: 100}, {offset: 200, width: 360})).toBe(0);
  });
  it('lines up a chip wider than the row by its left edge', () => {
    expect(scrollOffsetToShow({x: 500, width: 500}, view)).toBe(484);
  });
  it('waits until the row is measured', () => {
    expect(scrollOffsetToShow({x: 500, width: 100}, {offset: 0, width: 0})).toBeNull();
  });
});

it('scrolls the row when the selected chip is laid out past the right edge', () => {
  let hook!: ReturnType<typeof useSelectedChipScroll>;
  const Probe = ({selected}: {selected: string}) => {
    hook = useSelectedChipScroll(selected);
    return null;
  };
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<Probe selected="world" />);
  });
  const scrollTo = jest.fn();
  (hook.ref as any).current = {scrollTo};
  const layout = (x: number, width: number) => ({nativeEvent: {layout: {x, y: 0, width, height: 40}}}) as any;
  act(() => hook.scrollProps.onLayout(layout(0, 360)));
  act(() => hook.chipLayout('view:favourites')(layout(0, 120)));
  expect(scrollTo).not.toHaveBeenCalled();
  act(() => hook.chipLayout('world')(layout(560, 100)));
  expect(scrollTo).toHaveBeenLastCalledWith({x: 560 + 100 + 16 - 360, animated: true});

  // Picking a chip at the start scrolls back.
  scrollTo.mockClear();
  act(() => tree.update(<Probe selected="view:favourites" />));
  expect(scrollTo).toHaveBeenLastCalledWith({x: 0, animated: true});
});

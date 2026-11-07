import React from 'react';
import renderer, {act} from 'react-test-renderer';

jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({primary: '#00f', onPrimary: '#fff', onSurface: '#000', onSurfaceVariant: '#333', surfaceContainerHigh: '#eee', error: '#f00'}),
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/components/ui/Text', () => require('react-native').Text);
jest.mock('../src/components/tv', () => {
  const ReactLib = require('react');
  // A host element that keeps the focus props, rendered with focused: false.
  const Focusable = ({children, ...props}: any) =>
    ReactLib.createElement('Focusable', props, typeof children === 'function' ? children({focused: false}) : children);
  return {TVFocusable: Focusable};
});

import PinPad from '../src/components/profiles/PinPad';

const keys = (tree: renderer.ReactTestRenderer) => tree.root.findAll(node => node.type === ('Focusable' as any));
const press = (tree: renderer.ReactTestRenderer, key: string) =>
  act(() => {
    keys(tree).find(node => node.props.testID === `pin-key-${key}`)!.props.onPress();
  });
const text = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll(node => typeof node.props.children === 'string').map(node => node.props.children).join('|');

describe('PinPad', () => {
  it('has a focusable button for every digit, delete and cancel, with first focus on 1', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<PinPad title="Enter PIN" onComplete={() => undefined} onCancel={() => undefined} />);
    });
    const ids = keys(tree).map(node => node.props.testID);
    expect(ids.sort()).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', 'cancel'].map(key => `pin-key-${key}`).sort());
    expect(keys(tree).filter(node => node.props.hasTVPreferredFocus).map(node => node.props.testID)).toEqual(['pin-key-1']);
    expect(keys(tree).every(node => typeof node.props.accessibilityLabel === 'string')).toBe(true);
  });

  it('sends four digits once, shows the error and clears for the next try', () => {
    const onComplete = jest.fn((pin: string) => (pin === '1234' ? undefined : 'Wrong PIN.'));
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<PinPad title="Enter PIN" onComplete={onComplete} />);
    });
    for (const key of ['9', '8', 'back', '7', '6', '5']) press(tree, key);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenLastCalledWith('9765');
    expect(text(tree)).toContain('Wrong PIN.');
    for (const key of ['1', '2', '3', '4']) press(tree, key);
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenLastCalledWith('1234');
    expect(text(tree)).not.toContain('Wrong PIN.');
    // No cancel button without onCancel.
    expect(keys(tree).some(node => node.props.testID === 'pin-key-cancel')).toBe(false);
  });
});

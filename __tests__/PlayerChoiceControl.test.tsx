import React, {useState} from 'react';
import renderer, {act} from 'react-test-renderer';
import PlayerChoiceControl from '../src/components/PlayerChoiceControl';
import {
  NIGHT_MODE_NEEDS_DECODED,
  NIGHT_MODE_OPTIONS,
  type NightMode,
} from '../src/lib/player/audioEffects';

jest.mock('@expo/vector-icons/MaterialIcons', () => {
  const ReactModule = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: (props: object) => ReactModule.createElement(View, props),
  };
});

jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({
  useTVFocusBorderColor: (color: string) => color,
}));

const onChangeSpy = jest.fn();

const Harness = ({initial, unavailable}: {initial: NightMode; unavailable?: string}) => {
  const [value, setValue] = useState<NightMode>(initial);
  return (
    <PlayerChoiceControl
      title="Night mode"
      hint="Quieter loud scenes"
      icon="nights-stay"
      options={NIGHT_MODE_OPTIONS}
      value={value}
      accentColor="#3B82F6"
      unavailable={unavailable}
      onChange={next => {
        onChangeSpy(next);
        setValue(next);
      }}
    />
  );
};

// The outermost match is the Pressable element rendered for the choice.
const choice = (tree: renderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(
    node => node.props.accessibilityLabel === `Night mode: ${label}` && 'isTVSelectable' in node.props,
  )[0];

const texts = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findAll(node => typeof node.props.children === 'string')
    .map(node => node.props.children);

describe('PlayerChoiceControl', () => {
  beforeEach(() => onChangeSpy.mockClear());

  it('shows one focusable button per choice with the current one selected', async () => {
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<Harness initial="off" />);
    });
    for (const option of NIGHT_MODE_OPTIONS) {
      const button = choice(tree!, option.label);
      expect(button.props.focusable).toBe(true);
      expect(button.props.isTVSelectable).toBe(true);
      expect(button.props.accessibilityState.selected).toBe(option.value === 'off');
    }
    expect(texts(tree!)).toContain('Quieter loud scenes');
  });

  it('switches presets and ignores a press on the current one', async () => {
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<Harness initial="off" />);
    });
    await act(async () => {
      choice(tree!, 'Medium').props.onPress();
    });
    expect(onChangeSpy).toHaveBeenCalledWith('medium');
    expect(choice(tree!, 'Medium').props.accessibilityState.selected).toBe(true);
    expect(choice(tree!, 'Off').props.accessibilityState.selected).toBe(false);
    await act(async () => {
      choice(tree!, 'Medium').props.onPress();
    });
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
  });

  it('explains and locks the choices when the effect cannot apply', async () => {
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<Harness initial="light" unavailable={NIGHT_MODE_NEEDS_DECODED} />);
    });
    expect(texts(tree!)).toContain('Night mode needs decoded audio');
    expect(texts(tree!)).not.toContain('Quieter loud scenes');
    for (const option of NIGHT_MODE_OPTIONS) {
      const button = choice(tree!, option.label);
      expect(button.props.disabled).toBe(true);
      expect(button.props.focusable).toBe(false);
    }
  });
});

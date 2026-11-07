// The VLC player uses the same season marks and skip settings as the built-in player.
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {ToastAndroid} from 'react-native';

const mockSeek = jest.fn();
let mockVlcProps: any = {};
jest.mock('react-native-vlc-media-player', () => {
  const ReactActual = require('react');
  const {View} = require('react-native');
  return {
    VLCPlayer: ReactActual.forwardRef((props: any, ref: any) => {
      mockVlcProps = props;
      ReactActual.useImperativeHandle(ref, () => ({seek: mockSeek}));
      return ReactActual.createElement(View, {testID: 'vlc'});
    }),
  };
});
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}));
jest.mock('../src/components/ui/Text', () => {
  const {Text} = require('react-native');
  return {__esModule: true, default: Text, RawText: Text};
});
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/components/tv', () => {
  const ReactActual = require('react');
  const {Pressable: P, View} = require('react-native');
  return {
    TVFocusGuide: ({children}: any) => ReactActual.createElement(View, null, children),
    TVFocusable: ({children, ...props}: any) => ReactActual.createElement(P, props, children),
  };
});
jest.mock('../src/lib/storage', () => ({settingsStorage: {getSeekInterval: () => 10}}));
jest.mock('../src/lib/sources/vault', () => ({listSources: () => []}));
jest.mock('../src/lib/aniskip', () => ({findAnimeSkips: jest.fn(async () => [])}));

import VlcPlayerScreen, {providerSkipsOf} from '../src/screens/home/VlcPlayerScreen';
import {readSeasonMarks, setSkipMode, writeSeasonMarks} from '../src/lib/playback/skipSources';
import {markerKey} from '../src/lib/playback/introMarkers';
import {mainStorage} from '../src/lib/storage/StorageService';

const params = {
  directUrl: 'https://example.com/show-s01e02.mkv',
  primaryTitle: 'Some Show',
  providerValue: 'prov',
  type: 'series',
  meta: {title: 'Some Show', type: 'series', season: 1, episode: 2},
  episodeList: [{title: 'Episode 2', link: 'https://example.com/show-s01e02.mkv'}],
  linkIndex: 0,
};
const showKey = markerKey('Some Show', 'prov');

let tree: renderer.ReactTestRenderer | undefined;
const render = async (routeParams: any = params) => {
  await act(async () => {
    tree = renderer.create(<VlcPlayerScreen route={{params: routeParams}} navigation={{goBack: jest.fn()}} />);
  });
  return tree!;
};
const play = async (currentTime: number, duration = 1400) => {
  await act(async () => {
    mockVlcProps.onLoad?.({duration});
    mockVlcProps.onProgress?.({currentTime, duration});
  });
};
const button = (label: string) => tree!.root.findAll(node => typeof node.type !== 'string' && node.props.onPress && node.props.accessibilityLabel === label);
const shown = (label: string) => button(label).length > 0;
const startsWith = (prefix: string) =>
  tree!.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith(prefix) && node.props.onPress);

beforeEach(() => {
  mainStorage.clearAll();
  mockSeek.mockClear();
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});

describe('VLC player skip marks', () => {
  it('shows the skip button for season marks set in the built-in player', async () => {
    writeSeasonMarks(showKey, 1, {introStart: 10, introEnd: 80, runtime: 1400});
    await render();
    await play(20);
    expect(shown('Skip intro')).toBe(true);
    act(() => button('Skip intro')[0].props.onPress());
    expect(mockSeek).toHaveBeenCalledWith(80 / 1400);
  });

  it('marks for another season do not apply', async () => {
    writeSeasonMarks(showKey, 2, {introEnd: 80});
    await render();
    await play(20);
    expect(shown('Skip intro')).toBe(false);
  });

  it('skips on its own when the intro is set to Auto, once', async () => {
    writeSeasonMarks(showKey, 1, {introEnd: 80});
    setSkipMode('intro', 'auto');
    await render();
    await play(5);
    expect(mockSeek).toHaveBeenCalledTimes(1);
    expect(mockSeek).toHaveBeenCalledWith(80 / 1400);
    setSkipMode('intro', 'button');
  });

  it('leaves out kinds set to Off', async () => {
    writeSeasonMarks(showKey, 1, {introEnd: 80});
    setSkipMode('intro', 'off');
    await render();
    await play(20);
    expect(shown('Skip intro')).toBe(false);
    setSkipMode('intro', 'button');
  });

  it('saves marks for the whole season from the marks menu', async () => {
    await render();
    await play(95);
    act(() => button('Mark intro and credits')[0].props.onPress());
    act(() => startsWith('Intro ends here')[0].props.onPress());
    expect(readSeasonMarks(showKey, 1).introEnd).toBe(95);
    expect(ToastAndroid.show).toHaveBeenCalledWith('Saved for season 1', ToastAndroid.SHORT);
    await play(1300);
    act(() => startsWith('Credits start here')[0].props.onPress());
    expect(readSeasonMarks(showKey, 1)).toEqual(expect.objectContaining({introEnd: 95, creditsStart: 1300, runtime: 1400}));
    act(() => startsWith('Clear marks')[0].props.onPress());
    expect(readSeasonMarks(showKey, 1).introEnd).toBeUndefined();
  });

  it('uses the provider skip times of the episode', async () => {
    expect(providerSkipsOf({episodeList: [{skip: [{title: 'Recap', from: 0, to: 30}]}], initialStream: {skips: [{title: 'Intro', from: 40, to: 90}]}})).toHaveLength(2);
    await render({...params, episodeList: [{...params.episodeList[0], skip: [{title: 'Recap', from: 0, to: 30}]}]});
    await play(10);
    expect(shown('Skip recap')).toBe(true);
  });
});

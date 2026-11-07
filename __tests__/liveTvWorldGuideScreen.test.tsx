// All countries in Live TV, and the free guide on the TV guide screen.
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Text, TextInput, ToastAndroid} from 'react-native';

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
jest.mock('../src/lib/livetv/reminders', () => ({
  reminderId: (key: string, start: number) => `${key}@${start}`,
  reminderIds: () => new Set<string>(),
  toggleReminder: jest.fn(),
}));
jest.mock('../src/lib/livetv/guideLoader', () => ({
  ...jest.requireActual('../src/lib/livetv/guideLoader'),
  loadXmltvGuide: jest.fn(),
  peekXmltvGuide: jest.fn(async () => undefined),
}));
jest.mock('../src/lib/livetv/allCountries', () => ({
  ...jest.requireActual('../src/lib/livetv/allCountries'),
  loadAllCountries: jest.fn(),
}));

import LiveTV from '../src/screens/livetv/LiveTV';
import LiveGuide from '../src/screens/livetv/LiveGuide';
import {loadXmltvGuide} from '../src/lib/livetv/guideLoader';
import {loadAllCountries, type AllChannel} from '../src/lib/livetv/allCountries';
import {resetDetectedCountryForTests} from '../src/lib/livetv/deviceCountry';
import {DEFAULT_FILTERS} from '../src/lib/livetv/filters';
import {HOUR} from '../src/lib/livetv/guide';
import {getChannelFilters, setChannelFilters, setEpgOverride} from '../src/lib/livetv/store';
import {getSavedLiveView, WORLD_ALL_ID} from '../src/lib/livetv/world';
import {AUTO_GUIDE_MAX_BYTES} from '../src/lib/livetv/worldGuides';
import {openStore} from '../src/lib/storage/openStore';

const textOf = (node: renderer.ReactTestInstance): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');
const lines = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(textOf);
const pressable = (tree: renderer.ReactTestRenderer, label: string | RegExp) =>
  tree.root.findAll(node =>
    typeof node.props.onPress === 'function' &&
    typeof node.props.accessibilityLabel === 'string' &&
    (typeof label === 'string' ? node.props.accessibilityLabel === label : label.test(node.props.accessibilityLabel)),
  )[0];
const press = (tree: renderer.ReactTestRenderer, label: string | RegExp) => act(async () => pressable(tree, label).props.onPress());

const channel = (name: string, countries: string[], group = 'News'): AllChannel => ({
  id: `https://s.example/${name}.m3u8`,
  name,
  url: `https://s.example/${name}.m3u8`,
  group,
  countries,
  sourceId: WORLD_ALL_ID,
});
const ALL = [channel('BBC One', ['GB']), channel('Das Erste', ['DE', 'AT']), channel('Arte', ['FR', 'DE'], 'Culture'), channel('World News', ['INT'])];

const UK_M3U = `#EXTM3U
#EXTINF:-1 tvg-id="BBCOne.uk@SD" group-title="General",BBC One (1080p)
https://s.example/bbc.m3u8
`;

beforeEach(() => {
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  const live = openStore('droid-stream-livetv');
  for (const key of live.getAllKeys?.() || []) live.removeItem(key);
  resetDetectedCountryForTests();
  (loadAllCountries as jest.Mock).mockResolvedValue({channels: ALL, fetchedAt: Date.now()});
  (loadXmltvGuide as jest.Mock).mockReset();
  (global as any).fetch = jest.fn().mockResolvedValue({ok: true, status: 200, text: async () => UK_M3U});
});

describe('All countries', () => {
  it('is in the country list and shows every country with a country filter', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LiveTV navigation={{navigate: jest.fn()}} />);
    });
    await press(tree, 'World');
    await press(tree, /^All countries, Every country in one list/);
    expect(getSavedLiveView()).toBe(WORLD_ALL_ID);
    let text = lines(tree);
    expect(text).toEqual(expect.arrayContaining(['🌐 All countries', 'BBC One', 'Das Erste', 'Arte', 'World News']));
    // Country chips, most channels first, with flags.
    expect(text).toEqual(expect.arrayContaining(['All countries', '🇩🇪 Germany', '🇬🇧 United Kingdom', '🌐 International']));
    await press(tree, 'Germany, 2');
    text = lines(tree);
    expect(text).toEqual(expect.arrayContaining(['Das Erste', 'Arte']));
    expect(text).not.toContain('BBC One');
    expect(getChannelFilters(WORLD_ALL_ID).country).toBe('DE');
    // Group and search still work with the country.
    const search = tree.root.findAll(node => node.type === TextInput && node.props.accessibilityLabel === 'Search channels')[0];
    await act(async () => search.props.onChangeText('arte'));
    expect(lines(tree)).not.toContain('Das Erste');
    await act(async () => tree.unmount());
  });
});

describe('free guide on the TV guide screen', () => {
  const render = async (sourceId: string) => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LiveGuide navigation={{navigate: jest.fn()}} route={{params: {sourceId}}} />);
    });
    const area = tree.root.findAll(node => typeof node.props.onLayout === 'function' && node.props.style?.flex === 1)[0];
    await act(async () => area.props.onLayout({nativeEvent: {layout: {width: 800, height: 600}}}));
    return tree;
  };

  it("loads the country's free guide and matches channels by name", async () => {
    const now = Date.now();
    (loadXmltvGuide as jest.Mock).mockImplementation(async (url: string) => ({
      url,
      fetchedAt: now,
      names: {bbcone: 'BBC.One.HD.uk'},
      programmes: {'BBC.One.HD.uk': [{start: now - HOUR, stop: now + HOUR, title: 'News at One'}]},
    }));
    const tree = await render('world:gb');
    expect(loadXmltvGuide).toHaveBeenCalledWith(
      'https://www.open-epg.com/files/unitedkingdom.xml.gz',
      expect.objectContaining({ids: ['BBCOne.uk@SD'], names: expect.arrayContaining(['bbcone'])}),
      expect.objectContaining({maxBytes: AUTO_GUIDE_MAX_BYTES}),
    );
    expect(lines(tree)).toContain('News at One');
    await act(async () => tree.unmount());
  });

  it('uses the address you typed instead', async () => {
    setEpgOverride('world:gb', 'https://my.example/guide.xml');
    (loadXmltvGuide as jest.Mock).mockResolvedValue({url: 'x', fetchedAt: Date.now(), names: {}, programmes: {}});
    const tree = await render('world:gb');
    expect((loadXmltvGuide as jest.Mock).mock.calls.map(call => call[0])).toEqual(['https://my.example/guide.xml']);
    setEpgOverride('world:gb', '');
    await act(async () => tree.unmount());
  });

  it('says plainly when a country has no free guide', async () => {
    const tree = await render('world:jp');
    expect(loadXmltvGuide).not.toHaveBeenCalled();
    expect(lines(tree)).toContain('No guide available for this country.');
    await act(async () => tree.unmount());
  });

  it('asks for a country before loading the guide of All countries', async () => {
    (loadXmltvGuide as jest.Mock).mockResolvedValue({url: 'x', fetchedAt: Date.now(), names: {}, programmes: {}});
    let tree = await render(WORLD_ALL_ID);
    expect(loadXmltvGuide).not.toHaveBeenCalled();
    expect(lines(tree)).toContain('Pick a country in Filters to see its guide.');
    await act(async () => tree.unmount());
    setChannelFilters(WORLD_ALL_ID, {...DEFAULT_FILTERS, country: 'DE'});
    tree = await render(WORLD_ALL_ID);
    expect((loadXmltvGuide as jest.Mock).mock.calls.map(call => call[0])).toEqual(['https://www.open-epg.com/files/germany.xml.gz']);
    expect((loadXmltvGuide as jest.Mock).mock.calls[0][1].names).toEqual(expect.arrayContaining(['daserste', 'arte']));
    await act(async () => tree.unmount());
  });
});

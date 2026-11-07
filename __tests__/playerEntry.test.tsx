import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {ToastAndroid} from 'react-native';

const mockBools = new Map<string, boolean>();
let mockEngine: 'builtin' | 'vlc' = 'vlc';

jest.mock('../src/lib/storage', () => ({
  settingsStorage: {
    getPlayerEngine: () => mockEngine,
    getBool: (key: string, fallback = false) => mockBools.get(key) ?? fallback,
    setBool: (key: string, value: boolean) => mockBools.set(key, value),
  },
}));

import {
  VLC_HEADERS_NOTICE,
  VLC_HEADERS_NOTICE_KEY,
  createPlayerEntry,
  hasStreamHeaders,
} from '../src/screens/home/createPlayerEntry';

const Builtin = (_props: object) => React.createElement('Builtin');
const Vlc = (_props: object) => React.createElement('Vlc');
const PlayerEntry = createPlayerEntry<any>(Builtin, Vlc);

const render = (params: object) => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<PlayerEntry route={{params}} navigation={{}} />);
  });
  return tree;
};

const webdav = (headers?: Record<string, string>) => ({
  directUrl: 'https://dav.example.com/movie.mkv',
  initialStream: {
    server: 'Source',
    link: 'https://dav.example.com/movie.mkv',
    type: 'mkv',
    ...(headers ? {headers} : {}),
  },
});

describe('PlayerEntry', () => {
  let toast: jest.SpyInstance;

  beforeEach(() => {
    mockBools.clear();
    mockEngine = 'vlc';
    toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  });

  afterEach(() => toast.mockRestore());

  it('opens direct links in VLC when VLC is the engine', () => {
    const tree = render(webdav());
    expect(tree.root.findAllByType(Vlc)).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps streams that need headers on the built-in player', () => {
    const tree = render(webdav({Authorization: 'Basic abc'}));
    expect(tree.root.findAllByType(Builtin)).toHaveLength(1);
    expect(tree.root.findAllByType(Vlc)).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith(VLC_HEADERS_NOTICE, ToastAndroid.LONG);
    expect(mockBools.get(VLC_HEADERS_NOTICE_KEY)).toBe(true);
  });

  it('explains the switch only once', () => {
    render(webdav({Authorization: 'Basic abc'}));
    render(webdav({Authorization: 'Basic abc'}));
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('uses the built-in player without a notice when it is the engine', () => {
    mockEngine = 'builtin';
    const tree = render(webdav({Authorization: 'Basic abc'}));
    expect(tree.root.findAllByType(Builtin)).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('ignores empty header objects', () => {
    expect(hasStreamHeaders(webdav({}))).toBe(false);
    expect(hasStreamHeaders(webdav({Authorization: 'x'}))).toBe(true);
    expect(hasStreamHeaders(undefined)).toBe(false);
  });
});

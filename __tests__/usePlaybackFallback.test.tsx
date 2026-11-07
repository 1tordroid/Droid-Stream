import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {ToastAndroid} from 'react-native';
import type {Stream} from '../src/lib/providers/types';
import type {Candidate} from '../src/lib/streams/finder';
import {DEFAULT_FALLBACK_TIMEOUTS} from '../src/lib/streams/fallback';

const mockResolve = jest.fn();
jest.mock('../src/lib/streams/play', () => ({
  resolveCandidateStream: (...args: unknown[]) => mockResolve(...args),
}));
const mockRemember = jest.fn();
const mockForget = jest.fn();
jest.mock('../src/lib/streams/failedSources', () => ({
  rememberFailure: (...args: unknown[]) => mockRemember(...args),
  forgetFailure: (...args: unknown[]) => mockForget(...args),
}));

import {usePlaybackFallback} from '../src/lib/hooks/usePlaybackFallback';

/** Minimal renderHook on react-test-renderer. */
const renderHook = <T,>(useValue: () => T) => {
  const result = {} as {current: T};
  const Probe = () => {
    result.current = useValue();
    return null;
  };
  let root: renderer.ReactTestRenderer;
  act(() => {
    root = renderer.create(<Probe />);
  });
  return {result, rerender: (_?: unknown) => act(() => root.update(<Probe />))};
};

const candidate = (id: string): Candidate => ({id, kind: 'direct', url: `https://x/${id}.mp4`, title: id, origin: 'o', sizeBytes: 0, seeders: 0, cachedOn: [], lowQuality: false, languages: []});
const want = {title: 'Movie', type: 'movie' as const, imdbId: 'tt1'};
const plan = {want, candidates: [candidate('a'), candidate('b'), candidate('c')], index: 0, timeouts: DEFAULT_FALLBACK_TIMEOUTS};
const first: Stream = {server: 'o', link: 'https://x/a.mp4', type: 'mp4'};

const setup = (planOverride = plan) => {
  const position = {current: {position: 0}};
  let selected = first;
  const setSelectedStream = jest.fn((stream: Stream) => {
    selected = stream;
  });
  const hook = renderHook(() =>
    usePlaybackFallback({plan: planOverride, selectedStream: selected, setSelectedStream, videoPositionRef: position}),
  );
  return {hook, position, setSelectedStream, rerender: () => hook.rerender({})};
};

describe('usePlaybackFallback', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockResolve.mockReset().mockImplementation(async (c: Candidate) => ({server: 'o', link: c.url, type: 'mp4'}));
    mockRemember.mockReset();
    mockForget.mockReset();
    jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
  });
  afterEach(() => jest.useRealTimers());

  it('does nothing without a list', () => {
    const {hook} = setup({...plan, candidates: [candidate('a')]});
    expect(hook.result.current.active).toBe(false);
    expect(hook.result.current.handleError()).toBe(false);
  });

  it('switches to the next source on an error with a toast and remembers the failure', async () => {
    const {hook, setSelectedStream} = setup();
    let handled = false;
    await act(async () => {
      handled = hook.result.current.handleError();
    });
    expect(handled).toBe(true);
    expect(ToastAndroid.show).toHaveBeenCalledWith('Trying next source (2/3)', ToastAndroid.SHORT);
    expect(mockRemember).toHaveBeenCalledWith(want, 'a');
    expect(setSelectedStream).toHaveBeenLastCalledWith({server: 'o', link: 'https://x/b.mp4', type: 'mp4'});
  });

  it('switches when no first frame arrives in time, then shows the error after the last source', async () => {
    const {hook, setSelectedStream, rerender} = setup();
    await act(async () => {
      jest.advanceTimersByTime(DEFAULT_FALLBACK_TIMEOUTS.firstFrameMs + 1000);
    });
    expect(setSelectedStream).toHaveBeenLastCalledWith(expect.objectContaining({link: 'https://x/b.mp4'}));
    rerender();
    await act(async () => {
      hook.result.current.handleError();
    });
    rerender();
    expect(setSelectedStream).toHaveBeenLastCalledWith(expect.objectContaining({link: 'https://x/c.mp4'}));
    await act(async () => {
      hook.result.current.handleError();
    });
    expect(hook.result.current.exhausted).toBe(true);
    expect(mockRemember.mock.calls.map(call => call[1])).toEqual(['a', 'b', 'c']);
  });

  it('skips a source that cannot be resolved', async () => {
    mockResolve.mockImplementationOnce(async () => {
      throw new Error('gone');
    });
    const {hook, setSelectedStream} = setup();
    await act(async () => {
      hook.result.current.handleError();
    });
    expect(ToastAndroid.show).toHaveBeenCalledWith('Trying next source (3/3)', ToastAndroid.SHORT);
    expect(setSelectedStream).toHaveBeenLastCalledWith(expect.objectContaining({link: 'https://x/c.mp4'}));
  });

  it('stops after playback gets going and forgets an old failure of that source', async () => {
    const {hook, position} = setup();
    act(() => hook.result.current.handleLoad());
    for (let second = 1; second <= 7; second++) {
      position.current.position = second;
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(mockForget).toHaveBeenCalledWith(want, 'a');
    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    expect(mockRemember).not.toHaveBeenCalled();
  });
});

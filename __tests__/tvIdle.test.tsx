import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {createIdleTimer, isPlaybackRoute, minutesToMs} from '../src/lib/tv/idleTimer';
import {usePauseScreen} from '../src/lib/tv/usePauseScreen';
import {pickArtwork, smallArtwork} from '../src/lib/tv/artwork';
import {idleMinutesLabel, tvHomeSettings} from '../src/lib/tv/tvHomeSettings';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('createIdleTimer', () => {
  it('fires once after the delay and starts over on every poke', () => {
    const onIdle = jest.fn();
    const timer = createIdleTimer(onIdle, 1000);
    timer.poke();
    jest.advanceTimersByTime(900);
    timer.poke();
    jest.advanceTimersByTime(900);
    expect(onIdle).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(onIdle).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(timer.isWaiting()).toBe(false);
  });

  it('stops, and a delay of 0 turns it off', () => {
    const onIdle = jest.fn();
    const timer = createIdleTimer(onIdle, 1000);
    timer.poke();
    timer.stop();
    jest.advanceTimersByTime(2000);
    expect(onIdle).not.toHaveBeenCalled();
    timer.poke();
    timer.setDelay(0);
    jest.advanceTimersByTime(2000);
    expect(onIdle).not.toHaveBeenCalled();
    timer.setDelay(500);
    timer.poke();
    jest.advanceTimersByTime(500);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('applies a new delay to a running wait', () => {
    const onIdle = jest.fn();
    const timer = createIdleTimer(onIdle, 10_000);
    timer.poke();
    timer.setDelay(1000);
    jest.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('knows the minutes and the playback screens', () => {
    expect(minutesToMs(3)).toBe(180_000);
    expect(minutesToMs(0)).toBe(0);
    expect(isPlaybackRoute('Player')).toBe(true);
    expect(isPlaybackRoute('MultiView')).toBe(true);
    expect(isPlaybackRoute('Home')).toBe(false);
    expect(isPlaybackRoute(undefined)).toBe(false);
  });
});

describe('usePauseScreen', () => {
  let result: ReturnType<typeof usePauseScreen>;
  const Probe = (props: {paused: boolean; minutes: number}) => {
    result = usePauseScreen({...props, enabled: true});
    return null;
  };

  it('shows after the paused time, hides when playing, and comes back after dismiss', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Probe paused={false} minutes={3} />);
    });
    act(() => jest.advanceTimersByTime(minutesToMs(5)));
    expect(result.visible).toBe(false);

    act(() => tree.update(<Probe paused minutes={3} />));
    act(() => jest.advanceTimersByTime(minutesToMs(3) - 1000));
    expect(result.visible).toBe(false);
    act(() => jest.advanceTimersByTime(1000));
    expect(result.visible).toBe(true);

    act(() => result.dismiss());
    expect(result.visible).toBe(false);
    act(() => jest.advanceTimersByTime(minutesToMs(3)));
    expect(result.visible).toBe(true);

    act(() => tree.update(<Probe paused={false} minutes={3} />));
    expect(result.visible).toBe(false);
    act(() => tree.unmount());
  });

  it('does nothing when Off', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Probe paused minutes={0} />);
    });
    act(() => jest.advanceTimersByTime(minutesToMs(30)));
    expect(result.visible).toBe(false);
    act(() => tree.unmount());
  });

  it('restarts the wait when paused again', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Probe paused minutes={1} />);
    });
    act(() => jest.advanceTimersByTime(40_000));
    act(() => tree.update(<Probe paused={false} minutes={1} />));
    act(() => tree.update(<Probe paused minutes={1} />));
    act(() => jest.advanceTimersByTime(40_000));
    expect(result.visible).toBe(false);
    act(() => jest.advanceTimersByTime(20_000));
    expect(result.visible).toBe(true);
    act(() => tree.unmount());
  });
});

describe('TV idle settings and artwork', () => {
  it('defaults to 3 minutes for the pause screen and keeps Play Next on', () => {
    expect(tvHomeSettings.getPauseScreenMinutes()).toBe(3);
    expect(tvHomeSettings.isWatchNextEnabled()).toBe(true);
    tvHomeSettings.setPauseScreenMinutes(0);
    expect(tvHomeSettings.getPauseScreenMinutes()).toBe(0);
    tvHomeSettings.setScreensaverMinutes(10);
    expect(tvHomeSettings.getScreensaverMinutes()).toBe(10);
    expect(idleMinutesLabel(0)).toBe('Off');
    expect(idleMinutesLabel(1)).toBe('1 minute');
    expect(idleMinutesLabel(5)).toBe('5 minutes');
  });

  it('asks TMDB for small images and keeps a few distinct web images', () => {
    expect(smallArtwork('https://image.tmdb.org/t/p/original/a.jpg')).toBe('https://image.tmdb.org/t/p/w780/a.jpg');
    expect(smallArtwork('https://image.tmdb.org/t/p/w1280/a.jpg')).toBe('https://image.tmdb.org/t/p/w780/a.jpg');
    expect(smallArtwork('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    expect(pickArtwork(['file:///x.jpg', 'https://a/1.jpg', 'https://a/1.jpg', undefined, 'https://a/2.jpg', 'https://a/3.jpg'], 2)).toEqual([
      'https://a/1.jpg',
      'https://a/2.jpg',
    ]);
  });
});

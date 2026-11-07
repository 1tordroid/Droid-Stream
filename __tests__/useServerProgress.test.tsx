// The player hook: reports a Jellyfin item to its server while it plays,
// pauses with the player, stops on close, and leaves other videos alone.
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {useServerProgress} from '../src/lib/hooks/useServerProgress';
import {deleteSource, listSources, saveSource} from '../src/lib/sources/vault';
import {setServerProgressSyncEnabled} from '../src/lib/sources/serverProgress';

jest.mock('expo-crypto', () => ({randomUUID: () => 'install-a'}));

const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});

const ID = '0123456789abcdef0123456789abcdef';
const URLS = [`https://jf.local/Videos/${ID}/stream?static=true&ApiKey=jf-token`];

const Probe = ({urls, paused, position}: {urls: string[]; paused: boolean; position: {current: {position: number; duration: number}}}) => {
  useServerProgress(urls, paused, position);
  return null;
};

describe('useServerProgress', () => {
  let fetchMock: jest.Mock;
  let tree: renderer.ReactTestRenderer;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest.fn(() => json(204, {}));
    (globalThis as any).fetch = fetchMock;
    listSources().forEach(item => deleteSource(item.id));
    saveSource({id: 'jf', kind: 'jellyfin', name: 'Home', server: 'https://jf.local', username: 'user-guid', secret: 'jf-token', deviceId: 'install-a-jf'});
    setServerProgressSyncEnabled(true);
  });

  afterEach(() => jest.useRealTimers());

  const paths = () => fetchMock.mock.calls.map(call => String(call[0]).replace('https://jf.local', ''));

  it('reports start, progress, pause and stop', async () => {
    const position = {current: {position: 0, duration: 0}};
    await act(async () => {
      tree = renderer.create(<Probe urls={URLS} paused={false} position={position} />);
    });
    position.current = {position: 30, duration: 1200};
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(paths()).toEqual(['/Sessions/Playing']);

    position.current = {position: 40, duration: 1200};
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(paths()).toEqual(['/Sessions/Playing', '/Sessions/Playing/Progress']);

    await act(async () => {
      tree.update(<Probe urls={URLS} paused position={position} />);
    });
    const pause = fetchMock.mock.calls[2];
    expect(JSON.parse(pause[1].body)).toMatchObject({EventName: 'Pause', IsPaused: true, PositionTicks: 400_000_000});

    await act(async () => {
      tree.unmount();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(paths()[paths().length - 1]).toBe('/Sessions/Playing/Stopped');
  });

  it('sends nothing for other videos or with the setting off', async () => {
    const position = {current: {position: 30, duration: 1200}};
    await act(async () => {
      tree = renderer.create(<Probe urls={['https://elsewhere/film.mkv']} paused={false} position={position} />);
      await jest.advanceTimersByTimeAsync(20_000);
    });
    act(() => tree.unmount());

    setServerProgressSyncEnabled(false);
    await act(async () => {
      tree = renderer.create(<Probe urls={URLS} paused={false} position={position} />);
      await jest.advanceTimersByTimeAsync(20_000);
    });
    act(() => tree.unmount());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

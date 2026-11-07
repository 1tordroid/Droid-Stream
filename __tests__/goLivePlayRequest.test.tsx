// Go live on a phone: the controls keep their own pause state, so Go live sends
// a play request that starts playback even after a pause made on the controls.
import React, {useState} from 'react';
import renderer, {act} from 'react-test-renderer';
import {usePlayRequest} from '../src/components/media-console/hooks/usePlayRequest';

let paused = false;
let pauseOnControls: () => void = () => undefined;

const Controls = ({playRequest}: {playRequest?: number}) => {
  const [state, setState] = useState(false);
  paused = state;
  pauseOnControls = () => setState(true);
  usePlayRequest(playRequest, () => setState(false));
  return null;
};

describe('usePlayRequest', () => {
  it('plays on each new request and leaves the first value alone', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Controls playRequest={0} />);
    });
    act(() => pauseOnControls());
    expect(paused).toBe(true);
    // Re-rendering with the same request keeps the pause.
    act(() => tree.update(<Controls playRequest={0} />));
    expect(paused).toBe(true);
    // Go live.
    act(() => tree.update(<Controls playRequest={1} />));
    expect(paused).toBe(false);
    act(() => pauseOnControls());
    act(() => tree.update(<Controls playRequest={2} />));
    expect(paused).toBe(false);
    act(() => tree.unmount());
  });

  it('does nothing without a request', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Controls />);
    });
    act(() => pauseOnControls());
    act(() => tree.update(<Controls />));
    expect(paused).toBe(true);
    act(() => tree.unmount());
  });
});

import {useCallback, useEffect, useRef} from 'react';
import type {LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance} from 'react-native';
import type {LiveSource} from '../../lib/livetv/store';

/**
 * Keeps the selected chip of a horizontal chip row on screen. At 360 dp the
 * source row is wider than the screen, so a chosen source at the end was cut
 * off at the right edge.
 */

/** Short chip names. The source keeps its full name everywhere else. */
export const sourceChipLabel = (source: Pick<LiveSource, 'kind' | 'name'>): string =>
  source.kind === 'iptv-org' ? 'India' : source.name;

interface Span {
  x: number;
  width: number;
}

/**
 * The scroll offset that shows the whole chip with a small margin, or null
 * when it is already in view (or the row has not been measured yet).
 */
export const scrollOffsetToShow = (chip: Span, view: {offset: number; width: number}, margin = 16): number | null => {
  if (view.width <= 0 || chip.width <= 0) return null;
  const left = chip.x - margin;
  const right = chip.x + chip.width + margin;
  if (left < view.offset) return Math.max(0, left);
  if (right > view.offset + view.width) return Math.max(0, Math.min(left, right - view.width));
  return null;
};

export const useSelectedChipScroll = (selected: string | undefined) => {
  const ref = useRef<ScrollViewInstance>(null);
  const chips = useRef(new Map<string, Span>());
  const view = useRef({offset: 0, width: 0});
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const reveal = useCallback(() => {
    const key = selectedRef.current;
    const chip = key ? chips.current.get(key) : undefined;
    if (!chip) return;
    const target = scrollOffsetToShow(chip, view.current);
    if (target === null) return;
    view.current.offset = target;
    ref.current?.scrollTo({x: target, animated: true});
  }, []);

  useEffect(reveal, [reveal, selected]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      // A new layout is usually a remounted row (the header moves between
      // Live TV's modes), which starts at the left again.
      view.current = {offset: 0, width: event.nativeEvent.layout.width};
      reveal();
    },
    [reveal],
  );
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    view.current.offset = event.nativeEvent.contentOffset.x;
  }, []);
  const chipLayout = useCallback(
    (key: string) => (event: LayoutChangeEvent) => {
      const {x, width} = event.nativeEvent.layout;
      chips.current.set(key, {x, width});
      if (key === selectedRef.current) reveal();
    },
    [reveal],
  );

  return {ref, scrollProps: {onLayout, onScroll, scrollEventThrottle: 64}, chipLayout};
};

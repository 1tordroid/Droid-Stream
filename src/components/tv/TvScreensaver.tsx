import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Animated, AppState, StyleSheet, Text} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {pickArtwork} from '../../lib/tv/artwork';
import {isTV} from '../../lib/tv/constants';
import {createIdleTimer, isPlaybackRoute, minutesToMs, type IdleTimer} from '../../lib/tv/idleTimer';
import {subscribeTvHomeSettings, tvHomeSettings} from '../../lib/tv/tvHomeSettings';
import {useTVRemote} from '../../lib/tv/useTVRemote';
import useContinueWatchingStore from '../../lib/zustand/continueWatchingStore';
import useWatchListStore from '../../lib/zustand/watchListStore';
import KenBurnsImage from './KenBurnsImage';
import TvClock from './TvClock';
import TvIdleOverlay from './TvIdleOverlay';

/** Few, small images: the screensaver must stay light on 1 to 2 GB TV boxes. */
const MAX_SLIDES = 6;
const SLIDE_MS = 20000;
const SPOTS = [
  {right: 64, bottom: 56},
  {right: 120, bottom: 140},
  {left: 72, bottom: 72},
  {left: 120, bottom: 160},
];

interface Slide {
  uri: string;
  title: string;
}

/** Backdrops of Continue watching first, then posters from the library. */
const readSlides = (): Slide[] => {
  const continueItems = useContinueWatchingStore.getState().items;
  const library = useWatchListStore.getState().watchList;
  const candidates: {uri?: string; title: string}[] = [
    ...continueItems.map(item => ({uri: item.background, title: item.title})),
    ...continueItems.map(item => ({uri: item.poster, title: item.title})),
    ...library.map(item => ({uri: item.poster, title: item.title})),
  ];
  const slides: Slide[] = [];
  for (const candidate of candidates) {
    if (slides.length >= MAX_SLIDES) break;
    const uri = pickArtwork([candidate.uri], 1)[0];
    if (uri && !slides.some(slide => slide.uri === uri)) slides.push({uri, title: candidate.title});
  }
  return slides;
};

/**
 * In-app screensaver on TV: after the set idle time on any screen that does
 * not play video, slowly drifting artwork from the library with the clock.
 * Any key returns to the app. The system screensaver still starts at its own
 * time, as the app keeps the screen on only while a video plays.
 */
const TvScreensaver = ({getRouteName}: {getRouteName: () => string | undefined}) => {
  const [minutes, setMinutes] = useState(() => tvHomeSettings.getScreensaverMinutes());
  const [visible, setVisible] = useState(false);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState(0);
  const fade = useRef(new Animated.Value(0)).current;
  const visibleRef = useRef(false);
  visibleRef.current = visible;
  const routeRef = useRef(getRouteName);
  routeRef.current = getRouteName;

  const timer = useRef<IdleTimer>(null as unknown as IdleTimer);
  if (!timer.current) {
    timer.current = createIdleTimer(() => {
      if (AppState.currentState !== 'active' || isPlaybackRoute(routeRef.current())) {
        timer.current.poke();
        return;
      }
      setSlides(readSlides());
      setIndex(0);
      setSpot(0);
      setVisible(true);
    }, minutesToMs(minutes));
  }

  useEffect(() => subscribeTvHomeSettings(() => setMinutes(tvHomeSettings.getScreensaverMinutes())), []);

  useEffect(() => {
    timer.current.setDelay(minutesToMs(minutes));
    if (minutes > 0) timer.current.poke();
    else setVisible(false);
  }, [minutes]);

  useEffect(() => {
    const idle = timer.current;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') idle.poke();
      else {
        idle.stop();
        setVisible(false);
      }
    });
    return () => {
      subscription.remove();
      idle.stop();
    };
  }, []);

  useTVRemote(
    useCallback(() => {
      if (!visibleRef.current) timer.current.poke();
    }, []),
    isTV && minutes > 0,
  );

  // Next image every SLIDE_MS, faded through black; one image in memory at a time.
  useEffect(() => {
    if (!visible) return;
    fade.setValue(0);
    Animated.timing(fade, {toValue: 1, duration: 1500, useNativeDriver: true}).start();
    if (slides.length < 2) return;
    const next = setTimeout(() => {
      Animated.timing(fade, {toValue: 0, duration: 1500, useNativeDriver: true}).start(() => {
        setIndex(current => (current + 1) % slides.length);
        setSpot(current => (current + 1) % SPOTS.length);
      });
    }, SLIDE_MS);
    return () => clearTimeout(next);
  }, [visible, index, slides.length, fade]);

  // Without artwork the clock still moves now and then.
  useEffect(() => {
    if (!visible || slides.length > 1) return;
    const move = setInterval(() => setSpot(current => (current + 1) % SPOTS.length), 60000);
    return () => clearInterval(move);
  }, [visible, slides.length]);

  const dismiss = useCallback(() => {
    setVisible(false);
    timer.current.poke();
  }, []);

  const slide = slides[index];
  return (
    <TvIdleOverlay visible={visible} onDismiss={dismiss}>
      {slide ? (
        <Animated.View style={[StyleSheet.absoluteFill, {opacity: fade}]}>
          <KenBurnsImage key={`${index}-${slide.uri}`} uri={slide.uri} variant={index} durationMs={SLIDE_MS + 4000} />
        </Animated.View>
      ) : null}
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.75)']} style={StyleSheet.absoluteFill} />
      <Animated.View style={[styles.text, SPOTS[spot], 'right' in SPOTS[spot] ? styles.textRight : null, {opacity: slide ? fade : 1}]}>
        <TvClock style={styles.clock} />
        {slide?.title ? (
          <Text style={styles.title} numberOfLines={1}>
            {slide.title}
          </Text>
        ) : null}
      </Animated.View>
    </TvIdleOverlay>
  );
};

const styles = StyleSheet.create({
  text: {position: 'absolute', maxWidth: '50%'},
  textRight: {alignItems: 'flex-end'},
  clock: {fontSize: 56},
  title: {color: 'rgba(255,255,255,0.8)', fontFamily: 'Inter_500Medium', fontSize: 20, marginTop: 4},
});

export default TvScreensaver;

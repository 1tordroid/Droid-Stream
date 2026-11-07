import React, {useEffect, useRef, useState} from 'react';
import {Animated, StyleSheet, Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {smallArtwork} from '../../lib/tv/artwork';
import KenBurnsImage from './KenBurnsImage';
import TvClock from './TvClock';
import TvIdleOverlay from './TvIdleOverlay';

/** Corners the text moves between, so nothing stays on the same pixels. */
const SPOTS = [
  {left: 64, bottom: 64},
  {left: 96, bottom: 120},
  {left: 64, bottom: 180},
  {left: 128, bottom: 88},
];
const MOVE_EVERY_MS = 60000;

/**
 * Shown over the player on TV when a video has been paused for a while:
 * slowly moving artwork, the title, the clock and "Paused". Any key closes
 * it. It also keeps a still paused frame from marking OLED screens.
 */
const PauseScreen = ({
  visible,
  onDismiss,
  title,
  subtitle,
  artwork,
}: {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  subtitle?: string;
  artwork?: string;
}) => {
  const [spot, setSpot] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;
    setSpot(0);
    const timer = setInterval(() => {
      Animated.timing(fade, {toValue: 0, duration: 800, useNativeDriver: true}).start(() => {
        setSpot(current => (current + 1) % SPOTS.length);
        Animated.timing(fade, {toValue: 1, duration: 800, useNativeDriver: true}).start();
      });
    }, MOVE_EVERY_MS);
    return () => clearInterval(timer);
  }, [visible, fade]);

  const image = smallArtwork(artwork);
  return (
    <TvIdleOverlay visible={visible} onDismiss={onDismiss}>
      {image ? <KenBurnsImage uri={image} durationMs={30000} /> : null}
      <LinearGradient
        colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.9)']}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[styles.text, SPOTS[spot], {opacity: fade}]}>
        <TvClock />
        <Text style={styles.paused}>Paused</Text>
        {title ? (
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
        ) : null}
        {subtitle && subtitle !== title ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        <View style={styles.hintRow}>
          <Text style={styles.hint}>Press any button to close</Text>
        </View>
      </Animated.View>
    </TvIdleOverlay>
  );
};

const styles = StyleSheet.create({
  text: {position: 'absolute', maxWidth: '60%'},
  paused: {color: 'rgba(255,255,255,0.75)', fontFamily: 'Inter_500Medium', fontSize: 20, letterSpacing: 2, marginTop: 4, textTransform: 'uppercase'},
  title: {color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 40, marginTop: 18},
  subtitle: {color: 'rgba(255,255,255,0.85)', fontFamily: 'Inter_400Regular', fontSize: 22, marginTop: 6},
  hintRow: {marginTop: 22},
  hint: {color: 'rgba(255,255,255,0.55)', fontFamily: 'Inter_400Regular', fontSize: 16},
});

export default PauseScreen;

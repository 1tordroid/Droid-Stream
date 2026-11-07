import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet} from 'react-native';

/** Four slow zoom and pan paths, picked by [variant]. */
const PATHS = [
  {scale: [1.06, 1.18], x: [-18, 18], y: [-8, 8]},
  {scale: [1.18, 1.06], x: [16, -16], y: [10, -6]},
  {scale: [1.08, 1.2], x: [12, -20], y: [-10, 6]},
  {scale: [1.2, 1.08], x: [-14, 12], y: [8, -10]},
];

/**
 * A backdrop that slowly zooms and pans, back and forth, on the native
 * driver. Loaded downscaled (resizeMethod resize) to keep memory low.
 */
const KenBurnsImage = ({
  uri,
  variant = 0,
  durationMs = 24000,
  opacity,
}: {
  uri: string;
  variant?: number;
  durationMs?: number;
  opacity?: Animated.Value | Animated.AnimatedInterpolation<number>;
}) => {
  const progress = useRef(new Animated.Value(0)).current;
  const path = PATHS[Math.abs(variant) % PATHS.length];

  useEffect(() => {
    progress.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {toValue: 1, duration: durationMs, easing: Easing.inOut(Easing.quad), useNativeDriver: true}),
        Animated.timing(progress, {toValue: 0, duration: durationMs, easing: Easing.inOut(Easing.quad), useNativeDriver: true}),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, durationMs, uri]);

  const transform = [
    {scale: progress.interpolate({inputRange: [0, 1], outputRange: path.scale})},
    {translateX: progress.interpolate({inputRange: [0, 1], outputRange: path.x})},
    {translateY: progress.interpolate({inputRange: [0, 1], outputRange: path.y})},
  ];

  return (
    <Animated.Image
      source={{uri}}
      resizeMode="cover"
      resizeMethod="resize"
      fadeDuration={0}
      style={[StyleSheet.absoluteFill, {transform}, opacity !== undefined ? {opacity} : null]}
    />
  );
};

export default KenBurnsImage;

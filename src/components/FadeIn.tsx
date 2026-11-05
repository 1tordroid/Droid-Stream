import React, {useEffect, useRef} from 'react';
import {Animated, type ViewStyle} from 'react-native';

/** Fades content in once when it appears, on the native thread. */
const FadeIn = ({children, duration = 220, style}: {children: React.ReactNode; duration?: number; style?: ViewStyle}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {toValue: 1, duration, useNativeDriver: true}).start();
  }, [duration, opacity]);
  return <Animated.View style={[style, {opacity}]}>{children}</Animated.View>;
};

export default FadeIn;

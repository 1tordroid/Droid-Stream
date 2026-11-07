import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, type TextStyle} from 'react-native';

const formatTime = (date: Date): string => {
  try {
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  } catch {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
};

/** Hours and minutes, updated every few seconds. */
const TvClock = ({style}: {style?: TextStyle}) => {
  const [time, setTime] = useState(() => formatTime(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setTime(formatTime(new Date())), 10000);
    return () => clearInterval(timer);
  }, []);
  return <Text style={[styles.clock, style]}>{time}</Text>;
};

const styles = StyleSheet.create({
  clock: {color: '#fff', fontFamily: 'Inter_400Regular', fontSize: 44, letterSpacing: 1},
});

export default TvClock;

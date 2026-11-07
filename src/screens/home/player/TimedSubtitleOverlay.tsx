import React, {useEffect, useState} from 'react';
import {View, type ViewStyle} from 'react-native';
import {RawText as Text} from '../../../components/ui/Text';
import {cueTextAt, type SubtitleCue} from '../../../lib/subtitles/cueParser';

/**
 * Subtitle lines drawn by the app, for the second subtitle and translations
 * (Media3 shows one text track). The playback clock is read ten times a
 * second; the text only re-renders when the line changes.
 */
export default function TimedSubtitleOverlay({
  cues,
  delayMs,
  getTime,
  fontSize,
  color,
  position,
}: {
  cues: SubtitleCue[];
  delayMs: number;
  getTime: () => number;
  fontSize: number;
  color: string;
  position: Pick<ViewStyle, 'top' | 'bottom'>;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!cues.length) {
      setText('');
      return;
    }
    const tick = () => {
      const next = cueTextAt(cues, getTime() - delayMs / 1000);
      setText(previous => (previous === next ? previous : next));
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [cues, delayMs, getTime]);
  if (!text) return null;
  return (
    <View
      pointerEvents="none"
      style={{position: 'absolute', left: '6%', right: '6%', alignItems: 'center', zIndex: 20, ...position}}>
      <Text
        style={{
          color,
          fontSize,
          lineHeight: Math.round(fontSize * 1.3),
          textAlign: 'center',
          fontWeight: '500',
          backgroundColor: 'rgba(0,0,0,0.45)',
          paddingHorizontal: 10,
          paddingVertical: 3,
          borderRadius: 6,
          overflow: 'hidden',
          textShadowColor: 'rgba(0,0,0,0.9)',
          textShadowOffset: {width: 0, height: 1},
          textShadowRadius: 3,
        }}>
        {text}
      </Text>
    </View>
  );
}

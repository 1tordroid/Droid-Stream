import React, {useCallback, useEffect, useRef} from 'react';
import {Modal, Pressable, StyleSheet, View} from 'react-native';
import {useTVRemote} from '../../lib/tv/useTVRemote';

/**
 * Full-screen layer for the pause screen and the screensaver. Its own window
 * takes every key, so a key press only dismisses it and never reaches the
 * screen below. It closes on the key's release: closing on the press would
 * hand the release to the focused button below.
 */
const TvIdleOverlay = ({
  visible,
  onDismiss,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}) => {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearFallback = () => {
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = null;
  };
  const dismiss = useCallback(() => {
    clearFallback();
    dismissRef.current();
  }, []);

  useEffect(() => clearFallback, []);
  useEffect(() => {
    if (!visible) clearFallback();
  }, [visible]);

  useTVRemote(
    useCallback(
      event => {
        if (event.eventKeyAction === 0) {
          // Some keys send no release: close shortly after the press.
          clearFallback();
          fallback.current = setTimeout(dismiss, 350);
          return;
        }
        dismiss();
      },
      [dismiss],
    ),
    visible,
  );

  if (!visible) return null;
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      hardwareAccelerated
      onRequestClose={dismiss}>
      <View style={styles.fill}>
        {children}
        {/* Holds focus inside the layer; OK also closes it. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          hasTVPreferredFocus
          focusable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={dismiss}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fill: {flex: 1, backgroundColor: '#000'},
});

export default TvIdleOverlay;

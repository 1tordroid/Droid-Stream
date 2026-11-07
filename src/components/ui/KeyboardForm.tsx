import React from 'react';
import {KeyboardAvoidingView, ScrollView, StyleSheet, type ScrollViewProps} from 'react-native';

/**
 * A scrolling form that stays usable while the keyboard is open. The app draws
 * edge-to-edge, so Android no longer shrinks the screen for the keyboard. This
 * pads the form by the part the keyboard covers, so every field and the submit
 * button can be scrolled into view, and taps reach buttons without closing the
 * keyboard first.
 */
const KeyboardForm = ({children, style, keyboardShouldPersistTaps = 'handled', ...props}: ScrollViewProps) => (
  <KeyboardAvoidingView behavior="padding" style={[styles.fill, style]}>
    <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} style={styles.fill} {...props}>
      {children}
    </ScrollView>
  </KeyboardAvoidingView>
);

const styles = StyleSheet.create({fill: {flex: 1}});

export default KeyboardForm;

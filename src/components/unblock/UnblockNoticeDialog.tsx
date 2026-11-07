import React, {useState} from 'react';
import {ScrollView, ToastAndroid, useWindowDimensions} from 'react-native';
import {
  answerUnblockNotice,
  getUnblockMode,
  isUnblockNoticeSeen,
  isUnblockSupported,
  markUnblockNoticeSeen,
  UNBLOCK_NOTICE_TEXT,
} from '../../lib/unblock/unblockService';
import type {UnblockMode} from '../../lib/unblock/routing';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable} from '../tv';
import MaterialDialogSurface from '../ui/MaterialDialogSurface';
import AppText from '../ui/Text';
import UnblockModeChoices from './UnblockModeChoices';

/** Shown once to people updating from a version without Smart unblock. */
const UnblockNoticeDialog = () => {
  const colors = useM3Colors();
  const {height} = useWindowDimensions();
  const [visible, setVisible] = useState(() => isUnblockSupported() && !isUnblockNoticeSeen());
  const [mode, setMode] = useState<UnblockMode>(() => getUnblockMode());
  if (!visible) return null;

  const save = () => {
    setVisible(false);
    answerUnblockNotice(mode).catch(e => {
      ToastAndroid.show(`Could not change unblocking: ${e?.message || 'unknown error'}`, ToastAndroid.LONG);
    });
  };
  // Closing without OK keeps the current mode and does not agree to WARP.
  const close = () => {
    setVisible(false);
    markUnblockNoticeSeen();
  };

  return (
    <MaterialDialogSurface visible onDismiss={close} style={{maxHeight: Math.max(240, height - 48)}}>
      <ScrollView style={{flexShrink: 1}} showsVerticalScrollIndicator={false}>
        <AppText role="titleLarge" style={{color: colors.onSurface}}>
          Unblocking: Auto (recommended)
        </AppText>
        <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 8, marginBottom: 12}}>
          {UNBLOCK_NOTICE_TEXT}
        </AppText>
        <UnblockModeChoices value={mode} onChange={setMode} registerScreenFocus={false} hasTVPreferredFocus />
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 8}}>
          You can change this any time in Settings, Network.
        </AppText>
        <TVFocusable
          registerScreenFocus={false}
          accessibilityRole="button"
          accessibilityLabel="Save unblocking choice"
          onPress={save}
          borderRadius={24}
          style={{marginTop: 16, padding: 14, borderRadius: 24, alignItems: 'center', backgroundColor: colors.primary}}>
          <AppText role="labelLarge" style={{color: colors.onPrimary}}>
            OK
          </AppText>
        </TVFocusable>
      </ScrollView>
    </MaterialDialogSurface>
  );
};

export default UnblockNoticeDialog;

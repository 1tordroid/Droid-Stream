import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import {markTorrentVpnTipSeen, subscribeTorrentVpnTip} from '../../lib/unblock/torrentVpnTip';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable} from '../tv';
import MaterialDialogSurface from '../ui/MaterialDialogSurface';
import AppText from '../ui/Text';

/** One-time note: unblocking does not cover torrent peers. */
const TorrentVpnTip = ({onOpenSetting}: {onOpenSetting: () => void}) => {
  const colors = useM3Colors();
  const [visible, setVisible] = useState(false);

  useEffect(() => subscribeTorrentVpnTip(() => setVisible(true)), []);

  if (!visible) return null;
  const close = () => {
    markTorrentVpnTipSeen();
    setVisible(false);
  };
  const open = () => {
    close();
    onOpenSetting();
  };

  return (
    <MaterialDialogSurface visible onDismiss={close}>
      <AppText role="titleLarge" style={{color: colors.onSurface}}>
        Torrents are not unblocked
      </AppText>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 8}}>
        ByeDPI and WARP only cover the app's own connections, not torrent peers. For privacy, use a VPN app and turn on
        VPN bind and kill switch.
      </AppText>
      <View style={{flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16, gap: 8}}>
        <TVFocusable
          registerScreenFocus={false}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={close}
          borderRadius={20}
          style={{paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20}}>
          <AppText role="labelLarge" style={{color: colors.primary}}>
            Not now
          </AppText>
        </TVFocusable>
        <TVFocusable
          registerScreenFocus={false}
          hasTVPreferredFocus
          accessibilityRole="button"
          accessibilityLabel="Open VPN bind and kill switch"
          onPress={open}
          borderRadius={20}
          style={{paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: colors.primary}}>
          <AppText role="labelLarge" style={{color: colors.onPrimary}}>
            Open setting
          </AppText>
        </TVFocusable>
      </View>
    </MaterialDialogSurface>
  );
};

export default TorrentVpnTip;

import React from 'react';
import {ActivityIndicator, View} from 'react-native';
import QrCode from '../QrCode';
import Button from '../ui/Button';
import AppText from '../ui/Text';
import {isTV} from '../../lib/tv/constants';
import {useM3Colors} from '../../theme/M3PaletteContext';

/**
 * A sign-in code to type on another device, large enough to read from the
 * couch, with a QR code of the page to type it on when there is one. Side
 * by side on TV, stacked on phones.
 */
const SignInCode = ({
  code,
  before,
  after,
  qrValue,
  status,
  action,
}: {
  code: string;
  /** What to do, above the code, e.g. "Go to plex.tv/link and enter". */
  before: string;
  /** Where to enter it, below the code, when that reads better after it. */
  after?: string;
  /** The page to scan, when there is one. */
  qrValue?: string;
  status: string;
  /** A button under the status, focused first on TV so the D-pad has somewhere to be. */
  action?: {label: string; onPress: () => void};
}) => {
  const colors = useM3Colors();
  return (
    <View
      style={{
        marginTop: 12,
        padding: isTV ? 24 : 16,
        borderRadius: 16,
        backgroundColor: colors.surfaceContainerHigh,
        flexDirection: isTV ? 'row' : 'column',
        alignItems: 'center',
        gap: isTV ? 32 : 16,
      }}>
      {qrValue ? <QrCode value={qrValue} size={isTV ? 260 : 200} accessibilityLabel={`QR code for ${qrValue}`} /> : null}
      <View style={{alignItems: isTV && qrValue ? 'flex-start' : 'center', flexShrink: 1}}>
        <AppText role={isTV ? 'titleLarge' : 'bodyLarge'} style={{color: colors.onSurface, textAlign: isTV && qrValue ? 'left' : 'center'}}>
          {before}
        </AppText>
        <AppText
          role={isTV ? 'displayLargeEmphasized' : 'displayMediumEmphasized'}
          selectable
          accessibilityLabel={`Code ${code.split('').join(' ')}`}
          style={{color: colors.primary, letterSpacing: isTV ? 12 : 8, marginVertical: 8}}>
          {code}
        </AppText>
        {after ? (
          <AppText role={isTV ? 'titleMedium' : 'bodyMedium'} style={{color: colors.onSurfaceVariant, textAlign: isTV && qrValue ? 'left' : 'center'}}>
            {after}
          </AppText>
        ) : null}
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8}}>
          <ActivityIndicator size="small" color={colors.primary} />
          <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant}}>{status}</AppText>
        </View>
        {action ? (
          <View style={{flexDirection: 'row', marginTop: 12}}>
            <Button variant="tonal" onPress={action.onPress} hasTVPreferredFocus={isTV}>{action.label}</Button>
          </View>
        ) : null}
      </View>
    </View>
  );
};

export default SignInCode;

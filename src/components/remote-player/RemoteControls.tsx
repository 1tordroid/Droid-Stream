import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {ActivityIndicator, Image, Pressable, View} from 'react-native';
import IconButton from '../ui/IconButton';
import {useRemoteStore} from '../../lib/remote/remoteStore';
import {remotePlaybackManager} from '../../lib/remote/remotePlaybackManager';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {isTV} from '../../lib/tv';
import {settingsStorage} from '../../lib/storage';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// MaterialCommunityIcons only has numbered seek glyphs for these steps.
const SEEK_BACK_ICONS: Record<number, IconName> = {
  5: 'rewind-5',
  10: 'rewind-10',
  15: 'rewind-15',
  30: 'rewind-30',
  60: 'rewind-60',
};
const SEEK_FORWARD_ICONS: Record<number, IconName> = {
  5: 'fast-forward-5',
  10: 'fast-forward-10',
  15: 'fast-forward-15',
  30: 'fast-forward-30',
  60: 'fast-forward-60',
};

export const RemoteControls: React.FC = () => {
  const colors = useM3Colors();
  const status = useRemoteStore(state => state.status);
  const seeking = useRemoteStore(state => !!state.pendingSeek);
  const currentTime = useRemoteStore(state => state.currentTime);
  const duration = useRemoteStore(state => state.duration);
  const connectedDevice = useRemoteStore(state => state.connectedDevice);
  const [seekSeconds] = useState(() => settingsStorage.getSeekInterval());

  if (isTV) return null;

  const isPlaying = status === 'playing';
  const isBuffering =
    seeking || status === 'buffering' || status === 'loading' || status === 'connecting';
  const isError = status === 'error';
  const canControl =
    !!connectedDevice && (status === 'playing' || status === 'paused');
  // The centre button retries after an error; otherwise it plays or pauses.
  const centreEnabled = !!connectedDevice && !isBuffering && (canControl || isError);

  const handleCentrePress = () => {
    if (isError) {
      remotePlaybackManager.retry().catch(() => {});
    } else if (isPlaying) {
      remotePlaybackManager.pause().catch(() => {});
    } else if (canControl) {
      remotePlaybackManager.play().catch(() => {});
    }
  };

  const handleSeekOffset = (seconds: number) => {
    const target = Math.max(
      0,
      duration > 0 ? Math.min(currentTime + seconds, duration) : currentTime + seconds,
    );
    remotePlaybackManager.seek(target).catch(() => {});
  };

  return (
    <View
      style={{
        alignItems: 'center',
        flexDirection: 'row',
        gap: 32,
        justifyContent: 'center',
      }}>
      <IconButton
        icon={SEEK_BACK_ICONS[seekSeconds] ?? 'rewind'}
        label={`Back ${seekSeconds} seconds`}
        size={28}
        buttonSize={56}
        contentColor={colors.onSurface}
        disabled={!canControl}
        onPress={() => handleSeekOffset(-seekSeconds)}
      />

      <Pressable
        accessibilityLabel={isError ? 'Retry' : isPlaying ? 'Pause' : 'Play'}
        accessibilityRole="button"
        onPress={handleCentrePress}
        disabled={!centreEnabled}
        android_ripple={{color: colors.onPrimary, borderless: true, radius: 36}}
        style={{
          alignItems: 'center',
          backgroundColor: isError || isPlaying ? colors.primary : 'transparent',
          borderRadius: 40,
          height: 80,
          justifyContent: 'center',
          opacity: centreEnabled || isBuffering ? 1 : 0.38,
          width: 80,
        }}>
        {isBuffering ? (
          <ActivityIndicator size="small" color={colors.onSurface} />
        ) : isError || isPlaying ? (
          <MaterialCommunityIcons
            name={isError ? 'refresh' : 'pause'}
            size={36}
            color={colors.onPrimary}
          />
        ) : (
          <Image
            source={require('../../../assets/brand/play-button.png')}
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            style={{height: 80, width: 80}}
          />
        )}
      </Pressable>

      <IconButton
        icon={SEEK_FORWARD_ICONS[seekSeconds] ?? 'fast-forward'}
        label={`Forward ${seekSeconds} seconds`}
        size={28}
        buttonSize={56}
        contentColor={colors.onSurface}
        disabled={!canControl}
        onPress={() => handleSeekOffset(seekSeconds)}
      />
    </View>
  );
};

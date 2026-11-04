import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import {settingsStorage} from '../lib/storage';
import {useM3Colors} from '../theme/M3PaletteContext';
import AppText from './ui/Text';

const CARDS = [
  {title: 'Home', body: 'Home is the Vega catalog. Providers, posters, and playback stay where they were.'},
  {title: 'Torrents', body: 'Add a magnet or torrent file, then play while it downloads. Seeding stays off until you turn it on.'},
  {title: 'Library', body: 'Saved titles, videos on this device, and SMB, WebDAV, Jellyfin, Emby, Plex, and PikPak live here.'},
];

const FirstRunTips = () => {
  const colors = useM3Colors();
  const [step, setStep] = useState(() => (settingsStorage.hasSeenTips() ? -1 : 0));
  if (step < 0) return null;
  const card = CARDS[step];
  const finish = () => {
    settingsStorage.setTipsSeen();
    setStep(-1);
  };
  return (
    <View style={{position: 'absolute', left: 16, right: 16, bottom: 88, backgroundColor: colors.surfaceContainerHigh, borderRadius: 24, padding: 20}}>
      <AppText role="titleLarge" style={{color: colors.onSurface}}>{card.title}</AppText>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 8}}>{card.body}</AppText>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 16}}>
        <Pressable accessibilityRole="button" accessibilityLabel="Skip tips" onPress={finish} style={{minHeight: 48, justifyContent: 'center'}}>
          <AppText style={{color: colors.onSurfaceVariant}}>Skip</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={step === CARDS.length - 1 ? 'Done' : 'Next tip'}
          onPress={() => (step === CARDS.length - 1 ? finish() : setStep(step + 1))}
          style={{minHeight: 48, justifyContent: 'center'}}>
          <AppText style={{color: colors.primary}}>{step === CARDS.length - 1 ? 'Done' : 'Next'}</AppText>
        </Pressable>
      </View>
    </View>
  );
};

export default FirstRunTips;

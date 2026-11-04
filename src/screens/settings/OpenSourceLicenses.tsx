import React from 'react';
import {ScrollView, View} from 'react-native';
import AppText from '../../components/ui/Text';
import {useM3Colors} from '../../theme/M3PaletteContext';

const LICENSES = [
  {
    name: 'libVLC',
    license: 'LGPL-2.1',
    note: 'Linked dynamically through react-native-vlc-media-player for the optional VLC engine. Droid Stream does not modify libVLC.',
  },
  {
    name: 'VLC for Android media library',
    license: 'LGPL-2.1',
    note: 'The native media library used by the VLC engine. Source is available from VideoLAN.',
  },
  {
    name: 'libtorrent and libtorrent4j',
    license: 'BSD-3-Clause',
    note: 'One shared session for direct playback and the Torrents tab. Droid Stream does not copy GPL torrent-client code.',
  },
  {
    name: 'NanoHTTPD',
    license: 'BSD',
    note: 'Serves a torrent file to the on-device player at 127.0.0.1 only.',
  },
  {
    name: 'OkHttp',
    license: 'Apache-2.0',
    note: 'HTTP client used for segmented downloads.',
  },
];

const OpenSourceLicenses = () => {
  const colors = useM3Colors();
  return (
    <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={{padding: 20}}>
      <AppText role="headlineSmallEmphasized" className="mb-4 text-m3-on-background">
        Open-source licenses
      </AppText>
      {LICENSES.map(item => (
        <View key={item.name} style={{marginBottom: 18}}>
          <AppText role="titleMedium" className="text-m3-on-surface">{item.name}</AppText>
          <AppText role="labelLarge" className="text-m3-primary">{item.license}</AppText>
          <AppText role="bodyMedium" className="mt-1 text-m3-on-surface-variant">{item.note}</AppText>
        </View>
      ))}
    </ScrollView>
  );
};

export default OpenSourceLicenses;

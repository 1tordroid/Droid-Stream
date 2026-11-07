import React from 'react';
import {ScrollView, View} from 'react-native';
import AppText from '../../components/ui/Text';
import {useM3Colors} from '../../theme/M3PaletteContext';

const LICENSES = [
  {
    name: 'Inter font',
    license: 'OFL-1.1',
    note: 'The app font, by The Inter Project Authors. The license ships with the font files.',
  },
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
  {
    name: 'yt-dlp',
    license: 'Unlicense',
    note: "The video downloader. Droid Stream ships one release and can update it from https://github.com/yt-dlp/yt-dlp. It runs unchanged; the bridge around it is Droid Stream's own code.",
  },
  {
    name: 'yt-dlp-ejs',
    license: 'Unlicense, with meriyah (ISC) and astring (MIT)',
    note: "The YouTube challenge solver bundled with yt-dlp. It runs in Android's JavaScript sandbox. https://github.com/yt-dlp/ejs",
  },
  {
    name: 'Python (CPython)',
    license: 'PSF-2.0',
    note: 'Runs yt-dlp inside the app. Copyright (c) 2001 Python Software Foundation; All Rights Reserved. https://www.python.org',
  },
  {
    name: 'Chaquopy',
    license: 'MIT',
    note: 'Builds Python into the app and connects it to Kotlin. https://github.com/chaquo/chaquopy',
  },
  {
    name: 'Libraries in the Python build',
    license: 'OpenSSL: Apache-2.0; SQLite: public domain; libffi: MIT; bzip2: BSD-style; xz: 0BSD',
    note: "Parts of Python's standard library, as built by Chaquopy.",
  },
  {
    name: 'FFmpeg through FFmpegKit',
    license: 'LGPL-3.0 (FFmpeg) and LGPL-3.0 (FFmpegKit)',
    note: 'Merges, converts and cuts what yt-dlp downloads, and remuxes MKV for casting. Linked dynamically from ffmpeg-kit-https. https://ffmpeg.org',
  },
  {
    name: 'Jetpack JavaScript Engine (androidx.javascriptengine)',
    license: 'Apache-2.0',
    note: 'Runs the YouTube challenge solver in an isolated process.',
  },
  {
    name: 'Apache Commons Net',
    license: 'Apache-2.0',
    note: 'FTP and FTPS downloads. By The Apache Software Foundation.',
  },
  {
    name: 'jiotv_go by the jiotv-go project',
    license: 'CC-BY-4.0',
    note: 'The JioTV source in Live TV adapts its sign-in, token renewal, channel list and stream request logic, rewritten in TypeScript and changed to run inside the app. https://github.com/jiotv-go/jiotv_go. Not affiliated with Jio.',
  },
  {
    name: 'EasyList, EasyPrivacy and IndianList',
    license: 'GPL-3.0 or CC BY-SA 3.0 (dual licensed)',
    note: "Filter lists for the browser's ad and tracker blocker, by the EasyList authors and the IndianList maintainers. The app downloads them from easylist.to and easylist-downloads.adblockplus.org; they are not shipped with it. The blocker that reads them is Droid Stream's own code.",
  },
  {
    name: 'AndroidX WebKit',
    license: 'Apache-2.0',
    note: 'Passkey support in the browser.',
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

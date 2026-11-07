import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {Linking, Pressable, ScrollView, View} from 'react-native';
import AppText from '../../components/ui/Text';
import {useM3Colors} from '../../theme/M3PaletteContext';

type Credit = {name: string; note: string; url?: string};

const SECTIONS: {title: string; intro: string; items: Credit[]}[] = [
  {
    title: 'Built on',
    intro: 'Droid Stream is based on this project and stays compatible with its providers.',
    items: [{name: 'Vega by vega-org', note: 'The original app, its layout, and the provider system.', url: 'https://github.com/vega-org/vega-app'}],
  },
  {
    title: 'Code and libraries',
    intro: 'Used under their own licenses. Full details are on the Open-source licenses page.',
    items: [
      {name: 'libtorrent and libtorrent4j', note: 'Torrent engine.', url: 'https://github.com/aldenml/libtorrent4j'},
      {name: 'libVLC by VideoLAN', note: 'VLC playback engine, linked dynamically.', url: 'https://www.videolan.org/vlc/libvlc.html'},
      {name: 'NanoHTTPD', note: 'Local server that streams torrents to the player.', url: 'https://github.com/NanoHttpd/nanohttpd'},
      {name: 'smbj', note: 'SMB network shares.', url: 'https://github.com/hierynomus/smbj'},
      {name: 'yt-dlp', note: 'The video downloader, run unchanged inside the app.', url: 'https://github.com/yt-dlp/yt-dlp'},
      {name: 'Python and Chaquopy', note: 'Run yt-dlp on Android.', url: 'https://chaquo.com/chaquopy/'},
      {name: 'FFmpeg and FFmpegKit', note: 'Merge and convert downloaded video and audio.', url: 'https://github.com/arthenica/ffmpeg-kit'},
      {name: 'cheerio', note: 'Reads torrent site pages.', url: 'https://github.com/cheeriojs/cheerio'},
      {name: 'Inter by Rasmus Andersson', note: 'App font, SIL Open Font License.', url: 'https://github.com/rsms/inter'},
      {name: 'JioTV Go by the jiotv-go project', note: 'Parts of its sign-in and channel logic are adapted for the JioTV source in Live TV (Sign in with Jio, token renewal, channel list and stream requests), and Live TV can also load the playlist from your own JioTV Go server. Licensed CC BY 4.0. Not affiliated with Jio.', url: 'https://github.com/jiotv-go/jiotv_go'},
    ],
  },
  {
    title: 'Open protocols and services',
    intro: 'Droid Stream talks to these. Each one is optional and belongs to its owner.',
    items: [
      {name: 'Stremio add-on protocol', note: 'Add-on support, written from the public protocol.', url: 'https://github.com/Stremio/stremio-addon-sdk'},
      {name: 'Cinemeta', note: 'Movie and show details.', url: 'https://www.stremio.com'},
      {
        name: 'TMDB (The Movie Database)',
        note: 'Posters, artwork and details for your library and title pages, with your own API key. This product uses the TMDB API but is not endorsed or certified by TMDB.',
        url: 'https://www.themoviedb.org/api-terms-of-use',
      },
      {name: 'Jikan and AniSkip', note: 'Anime details and skip times.', url: 'https://jikan.moe'},
      {name: 'OpenSubtitles', note: 'Subtitle matching.', url: 'https://www.opensubtitles.com'},
      {name: 'Trakt, Simkl and AniList', note: 'Watch history sync.', url: 'https://trakt.tv'},
      {name: 'iptv-org', note: 'Public list of free-to-air channels behind the Free Indian channels source in Live TV.', url: 'https://github.com/iptv-org/iptv'},
      {name: 'EasyList and EasyPrivacy', note: "Filter lists by the EasyList authors, downloaded by the browser's ad and tracker blocker.", url: 'https://easylist.to'},
      {name: 'IndianList', note: "Filter list for Indian sites by its maintainers, downloaded by the browser's ad blocker.", url: 'https://easylist.to'},
    ],
  },
  {
    title: 'Ideas and inspiration',
    intro: 'These projects inspired features or design. Droid Stream uses none of their code and is not affiliated with them.',
    items: [
      {name: 'CloudStream', note: 'Open-source streaming app.', url: 'https://github.com/recloudstream/cloudstream'},
      {name: 'Nuvio', note: 'Open-source streaming app. Its script plugin format is supported.', url: 'https://github.com/NuvioMedia/NuvioMobile'},
      {name: 'Stremio', note: 'Add-on driven streaming.', url: 'https://www.stremio.com'},
      {name: 'qBittorrent, LibreTorrent and Transmission', note: 'Torrent client ideas.'},
      {name: 'pikpak-plus', note: 'Cloud download ideas.'},
      {name: 'VidHub, 1DM and IDM', note: 'Library and download manager ideas.'},
      {name: 'YTDLnis and Seal', note: 'Video downloader ideas. The Droid Stream downloader is its own code.'},
      {name: '1DM, PikPak, SnapTube and Titanium Browser', note: 'Browser and download detection ideas. The Droid Stream browser is its own code.'},
      {name: 'MovieBox, Netflix and Castle', note: 'Browsing and design ideas.'},
    ],
  },
];

const Credits = () => {
  const colors = useM3Colors();
  return (
    <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 96}}>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Credits</AppText>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>Droid Stream exists thanks to these people and projects.</AppText>
      {SECTIONS.map(section => (
        <View key={section.title} style={{marginTop: 24}}>
          <AppText role="titleMedium" style={{color: colors.primary}}>{section.title}</AppText>
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 2, marginBottom: 8}}>{section.intro}</AppText>
          <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 16, overflow: 'hidden'}}>
            {section.items.map((item, index) => (
              <Pressable
                key={item.name}
                accessibilityRole={item.url ? 'link' : 'text'}
                accessibilityLabel={item.name}
                disabled={!item.url}
                onPress={() => item.url && Linking.openURL(item.url)}
                style={{flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: index ? 1 : 0, borderColor: colors.outlineVariant}}>
                <View style={{flex: 1}}>
                  <AppText role="bodyLarge" style={{color: colors.onSurface}}>{item.name}</AppText>
                  <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{item.note}</AppText>
                </View>
                {item.url ? <MaterialCommunityIcons name="open-in-new" size={18} color={colors.onSurfaceVariant} /> : null}
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
};

export default Credits;

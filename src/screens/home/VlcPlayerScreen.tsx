import {VLCPlayer} from 'react-native-vlc-media-player';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useMemo, useRef, useState} from 'react';
import {Image, Pressable, ToastAndroid, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import AppText from '../../components/ui/Text';
import {settingsStorage} from '../../lib/storage';
import {
  markerKey,
  markersToSkips,
  readShowMarkers,
  writeShowMarkers,
} from '../../lib/playback/introMarkers';
import type {SkipInterval} from '../../lib/providers/types';

type Track = {id: number; name: string};

/**
 * Direct-file player built on libVLC. Provider pages stay on the built-in
 * player, which already resolves their streams.
 */
const VlcPlayerScreen = ({route, navigation}: {route: any; navigation: any}) => {
  const insets = useSafeAreaInsets();
  const params = route.params || {};
  const uri =
    params.directUrl ||
    params.file ||
    params.initialStream?.link ||
    params.episodeList?.[params.linkIndex || 0]?.link ||
    '';
  const title = params.primaryTitle || params.secondaryTitle || 'Droid Stream';
  const showKey = markerKey(params.primaryTitle, params.providerValue);
  const player = useRef<any>(null);
  const [paused, setPaused] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioTracks, setAudioTracks] = useState<Track[]>([]);
  const [textTracks, setTextTracks] = useState<Track[]>([]);
  const [audioTrack, setAudioTrack] = useState<number | undefined>();
  const [textTrack, setTextTrack] = useState<number | undefined>();
  const [showTracks, setShowTracks] = useState(false);
  const [markers, setMarkers] = useState(() => readShowMarkers(showKey));
  const seekSeconds = settingsStorage.getSeekInterval();

  const skips = useMemo(() => markersToSkips(markers), [markers]);
  const activeSkip = skips.find(item => time >= item.from && time < item.to);

  const seekTo = (seconds: number) => {
    if (!duration) return;
    const next = Math.max(0, Math.min(duration - 0.5, seconds));
    player.current?.seek(next / duration);
    setTime(next);
  };

  const remember = (patch: Partial<typeof markers>) => {
    const next = {...markers, chapters: markers.chapters, ...patch};
    setMarkers(next);
    writeShowMarkers(showKey, next);
    ToastAndroid.show('Saved on this device', ToastAndroid.SHORT);
  };

  if (!uri) {
    return (
      <View style={{flex: 1, backgroundColor: '#000', justifyContent: 'center', padding: 24}}>
        <AppText className="text-center text-white">
          VLC plays a direct video file or stream. This title has no direct address yet, so use the built-in player.
        </AppText>
        <Pressable onPress={() => navigation.goBack()} style={{marginTop: 20, alignSelf: 'center'}}>
          <AppText style={{color: '#E2B340'}}>Go back</AppText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{flex: 1, backgroundColor: '#000'}}>
      <VLCPlayer
        ref={player}
        style={{flex: 1}}
        source={{uri, initOptions: ['--audio-time-stretch', '--sub-track=0']}}
        autoplay
        paused={paused}
        audioTrack={audioTrack}
        textTrack={textTrack}
        onLoad={(event: {duration: number; audioTracks?: Track[]; textTracks?: Track[]}) => {
          setDuration(event.duration || 0);
          setAudioTracks(event.audioTracks || []);
          setTextTracks(event.textTracks || []);
        }}
        onProgress={(event: {currentTime: number; duration: number}) => {
          setTime(event.currentTime || 0);
          if (event.duration) setDuration(event.duration);
        }}
        onError={() => ToastAndroid.show('VLC could not open this video', ToastAndroid.LONG)}
      />
      <View style={{position: 'absolute', top: insets.top + 8, left: 12, right: 12, flexDirection: 'row', alignItems: 'center'}}>
        <Pressable accessibilityLabel="Close player" onPress={() => navigation.goBack()} style={{padding: 8}}>
          <MaterialCommunityIcons name="arrow-left" size={28} color="#fff" />
        </Pressable>
        <AppText className="flex-1 text-white" numberOfLines={1}>{title}</AppText>
        <Pressable accessibilityLabel="Audio and subtitles" onPress={() => setShowTracks(value => !value)} style={{padding: 8}}>
          <MaterialCommunityIcons name="subtitles" size={26} color="#fff" />
        </Pressable>
      </View>
      <View style={{position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 28, alignItems: 'center'}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 28}}>
          <Pressable accessibilityLabel={`Back ${seekSeconds} seconds`} onPress={() => seekTo(time - seekSeconds)} style={{padding: 12}}>
            <MaterialCommunityIcons name="rewind" size={36} color="#fff" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={paused ? 'Play' : 'Pause'}
            onPress={() => setPaused(value => !value)}
            style={{width: 96, height: 96, alignItems: 'center', justifyContent: 'center'}}>
            {paused ? (
              <Image source={require('../../../assets/brand/play-button.png')} style={{width: 96, height: 96}} resizeMode="contain" />
            ) : (
              <MaterialCommunityIcons name="pause" size={64} color="#fff" />
            )}
          </Pressable>
          <Pressable accessibilityLabel={`Forward ${seekSeconds} seconds`} onPress={() => seekTo(time + seekSeconds)} style={{padding: 12}}>
            <MaterialCommunityIcons name="fast-forward" size={36} color="#fff" />
          </Pressable>
        </View>
        <View style={{flexDirection: 'row', gap: 8, marginTop: 12}}>
          {activeSkip ? (
            <MarkerButton label={skipLabel(activeSkip)} onPress={() => seekTo(activeSkip.to)} />
          ) : null}
          <MarkerButton label="Mark intro" onPress={() => remember({introEnd: time})} />
          <MarkerButton label="Mark credits" onPress={() => remember({creditsStart: time})} />
          <MarkerButton
            label="Add chapter"
            onPress={() =>
              remember({
                chapters: [...markers.chapters, {title: `Chapter ${markers.chapters.length + 1}`, start: time}],
              })
            }
          />
        </View>
        {markers.chapters.length > 0 ? (
          <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 8, paddingHorizontal: 16}}>
            {markers.chapters.map(chapter => (
              <MarkerButton key={`${chapter.title}-${chapter.start}`} label={chapter.title} onPress={() => seekTo(chapter.start)} />
            ))}
          </View>
        ) : null}
      </View>
      {showTracks ? (
        <View style={{position: 'absolute', right: 12, top: insets.top + 56, backgroundColor: 'rgba(0,0,0,0.88)', borderRadius: 16, padding: 12, maxWidth: 260}}>
          <AppText className="text-white mb-2">Audio</AppText>
          {audioTracks.map(track => (
            <Pressable key={`a${track.id}`} onPress={() => setAudioTrack(track.id)} style={{paddingVertical: 6}}>
              <AppText style={{color: audioTrack === track.id ? '#E2B340' : '#fff'}}>{track.name}</AppText>
            </Pressable>
          ))}
          <AppText className="text-white mb-2 mt-2">Subtitles</AppText>
          <Pressable onPress={() => setTextTrack(-1)} style={{paddingVertical: 6}}>
            <AppText style={{color: '#fff'}}>Off</AppText>
          </Pressable>
          {textTracks.map(track => (
            <Pressable key={`t${track.id}`} onPress={() => setTextTrack(track.id)} style={{paddingVertical: 6}}>
              <AppText style={{color: textTrack === track.id ? '#E2B340' : '#fff'}}>{track.name}</AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const skipLabel = (skip: SkipInterval) =>
  skip.title?.toLowerCase().startsWith('skip') ? skip.title : `Skip ${skip.title || 'section'}`;

const MarkerButton = ({label, onPress}: {label: string; onPress: () => void}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    style={{backgroundColor: 'rgba(20,20,20,0.72)', borderColor: '#E2B340', borderRadius: 18, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8}}>
    <AppText style={{color: '#fff'}}>{label}</AppText>
  </Pressable>
);

export default VlcPlayerScreen;

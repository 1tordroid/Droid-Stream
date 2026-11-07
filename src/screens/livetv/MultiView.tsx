/**
 * Multi-view: 2 to 4 Live TV channels at once. Each tile is a bare player
 * (no controls); only the tile with the audio highlight is heard. Tap or
 * press OK on a tile to hear it, and again for its menu.
 *
 * Tiles stop when the screen is left (full screen, back) and pause while the
 * app is in the background. Small tiles take the lowest quality the stream
 * offers, and only one protected (DRM) channel plays at a time.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, AppState, ScrollView, StyleSheet, ToastAndroid, View} from 'react-native';
import Video, {type ReactVideoSource, type VideoRef} from 'react-native-video';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Chip from '../../components/torrentSearch/Chip';
import {TVFocusable} from '../../components/tv';
import Button from '../../components/ui/Button';
import AppText from '../../components/ui/Text';
import {knownProtectedChannels, rememberChannelProtection} from '../../lib/downloadEngine/engineStore';
import {getJioStream, jioChannelId, JIO_SOURCE_ID} from '../../lib/livetv/jio/channels';
import {
  addTile,
  audioKeyOf,
  DRM_LIMIT_MESSAGE,
  drmTileKey,
  effectiveLayout,
  layoutsFor,
  loadMultiView,
  maxBitRateFor,
  maxTiles,
  removeTile,
  replaceTile,
  saveMultiView,
  setAudio,
  setLayout,
  swapWithBig,
  tileQuality,
  tileRects,
  type MultiLayout,
  type MultiTile,
  type MultiViewState,
  type TileQuality,
  type TileRect,
  type TileResult,
} from '../../lib/livetv/multiview';
import {toSaved} from '../../lib/livetv/store';
import {findSource} from '../../lib/livetv/world';
import {isTV} from '../../lib/tv';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import {useM3Colors} from '../../theme/M3PaletteContext';
import MultiViewPicker from './MultiViewPicker';
import {openChannel, streamType, type GridChannel} from './play';

const GAP = 6;

const LAYOUT_CHIPS: {id: MultiLayout; label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']}[] = [
  {id: 'grid', label: 'Grid', icon: 'view-grid-outline'},
  {id: 'big', label: 'Big + small', icon: 'view-quilt-outline'},
];

interface TileStream {
  uri: string;
  type: string;
  headers?: Record<string, string>;
  drm?: ReactVideoSource['drm'];
}

/** The playable address of a tile. JioTV addresses expire, so each tile fetches a fresh one. */
const useTileStream = (channel: MultiTile['channel'], retry: number) => {
  const [stream, setStream] = useState<TileStream>();
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    const jioId = jioChannelId(channel.url);
    if (!jioId) {
      setStream({uri: channel.url, type: streamType(channel.url), ...(channel.headers ? {headers: channel.headers} : {})});
      return;
    }
    setStream(undefined);
    let alive = true;
    getJioStream(jioId)
      .then(result => {
        rememberChannelProtection(channel.url, Boolean(result.drm) || result.type === 'mpd');
        if (alive) setStream({uri: result.url, type: result.type, headers: result.headers, ...(result.drm ? {drm: result.drm} : {})});
      })
      .catch(err => alive && setError(err?.message || 'Could not open this channel.'));
    return () => {
      alive = false;
    };
  }, [channel.url, channel.headers, retry]);
  return {stream, error};
};

const Tile = ({tile, rect, quality, audio, playing, drmOwner, preferred, retry, register, onDrm, onPress, onLongPress}: {
  tile: MultiTile;
  rect: TileRect;
  quality: TileQuality;
  audio: boolean;
  playing: boolean;
  drmOwner?: string;
  preferred: boolean;
  retry: number;
  register: (key: string, video: VideoRef | null) => void;
  onDrm: (key: string, isProtected: boolean) => void;
  onPress: (failed: boolean) => void;
  onLongPress: (failed: boolean) => void;
}) => {
  const colors = useM3Colors();
  const {channel} = tile;
  const {stream, error: streamError} = useTileStream(channel, retry);
  const [playError, setPlayError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const isProtected = !!channel.drm || !!stream?.drm;
  const setVideo = useCallback((video: VideoRef | null) => register(tile.key, video), [register, tile.key]);

  useEffect(() => {
    setPlayError('');
    setLoaded(false);
  }, [stream]);
  useEffect(() => {
    onDrm(tile.key, isProtected);
    return () => onDrm(tile.key, false);
  }, [tile.key, isProtected, onDrm]);

  const blocked = isProtected && drmOwner !== tile.key;
  const error = streamError || playError || (blocked ? DRM_LIMIT_MESSAGE : '');
  const source = useMemo<ReactVideoSource | undefined>(
    () =>
      stream
        ? {
            uri: stream.uri,
            ...(stream.type === 'm3u8' || stream.type === 'mpd' ? {type: stream.type} : {}),
            ...(stream.headers ? {headers: stream.headers} : {}),
            ...(stream.drm ? {drm: stream.drm} : {}),
            // Small buffers: up to four players share the memory.
            bufferConfig: {
              minBufferMs: 4000,
              maxBufferMs: 30000,
              bufferForPlaybackMs: 1500,
              bufferForPlaybackAfterRebufferMs: 3000,
              backBufferDurationMs: 0,
              forwardBufferMB: 16,
              backBufferMB: 0,
              cacheSizeMB: 0,
            },
          }
        : undefined,
    [stream],
  );

  return (
    <TVFocusable
      accessibilityRole="button"
      accessibilityLabel={audio ? `${channel.name}, playing sound. Press for options.` : `${channel.name}. Press to hear it.`}
      hasTVPreferredFocus={preferred}
      onPress={() => onPress(!!error)}
      onLongPress={() => onLongPress(!!error)}
      focusScale={1}
      borderRadius={10}
      style={{position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000'}}>
      {source && !error ? (
        <Video
          ref={setVideo}
          source={source}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          muted={!audio}
          paused={!playing}
          maxBitRate={maxBitRateFor(quality)}
          // Tiles must not take audio focus from each other (that pauses them).
          disableFocus
          focusable={false}
          playInBackground={false}
          showNotificationControls={false}
          shutterColor="#000000"
          onLoad={() => setLoaded(true)}
          onBuffer={event => setBuffering(!!event?.isBuffering)}
          onError={(event: any) => setPlayError(event?.error?.errorString || event?.error?.localizedDescription || 'This channel did not play.')}
        />
      ) : null}
      {error ? (
        <View style={[StyleSheet.absoluteFill, {alignItems: 'center', justifyContent: 'center', padding: 12}]}>
          <MaterialCommunityIcons name={blocked ? 'shield-lock-outline' : 'alert-circle-outline'} size={26} color="#fff" />
          <AppText role="bodySmall" numberOfLines={4} style={{color: '#fff', textAlign: 'center', marginTop: 6}}>{error}</AppText>
        </View>
      ) : (!loaded || buffering) && playing ? (
        <ActivityIndicator color="#fff" style={StyleSheet.absoluteFill} />
      ) : null}
      <View style={{position: 'absolute', left: 6, bottom: 6, right: 6, flexDirection: 'row', alignItems: 'center'}} pointerEvents="none">
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: audio ? colors.primary : 'rgba(0,0,0,0.6)'}}>
          <MaterialCommunityIcons name={audio ? 'volume-high' : 'volume-off'} size={14} color={audio ? colors.onPrimary : '#fff'} />
          <AppText role="labelSmall" numberOfLines={1} style={{flexShrink: 1, color: audio ? colors.onPrimary : '#fff'}}>{channel.name}</AppText>
        </View>
      </View>
      {/* The tile you hear has a highlight. */}
      {audio ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, {borderRadius: 10, borderWidth: 3, borderColor: colors.primary}]} /> : null}
    </TVFocusable>
  );
};

type PickerMode = {mode: 'add'} | {mode: 'replace'; key: string};

const sourceNameOf = (sourceId: string) => (sourceId === JIO_SOURCE_ID ? 'JioTV' : findSource(sourceId)?.name || 'Live TV');

const MultiView = ({navigation}: {navigation: any}) => {
  const insets = useSafeAreaInsets();
  const max = useMemo(() => maxTiles(), []);
  const [state, setState] = useState<MultiViewState>(() => loadMultiView(max));
  const [focused, setFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [area, setArea] = useState({width: 0, height: 0});
  const [picker, setPicker] = useState<PickerMode>();
  const [drmKeys, setDrmKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [retries, setRetries] = useState<Record<string, number>>({});
  const [drmHolder, setDrmHolder] = useState<string>();
  const videos = useRef(new Map<string, VideoRef>());
  const register = useCallback((key: string, video: VideoRef | null) => {
    if (video) videos.current.set(key, video);
    else videos.current.delete(key);
  }, []);

  // Live TV may have added a channel. Leaving the screen (full screen, back)
  // pauses every player at once and then unmounts them, which stops them.
  useFocusEffect(
    useCallback(() => {
      setState(loadMultiView(max));
      setFocused(true);
      const playing = videos.current;
      return () => {
        for (const video of playing.values()) video.pause();
        setFocused(false);
      };
    }, [max]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => setAppActive(next === 'active'));
    return () => sub.remove();
  }, []);

  const update = (next: MultiViewState) => {
    setState(next);
    saveMultiView(next);
  };

  const onDrm = useCallback((key: string, isProtected: boolean) => {
    setDrmKeys(current => {
      if (current.has(key) === isProtected) return current;
      const next = new Set(current);
      if (isProtected) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  // The tile that plays DRM keeps it until it goes or stops being protected.
  const drmOwner = drmTileKey(state.tiles, drmKeys, drmHolder);
  useEffect(() => setDrmHolder(drmOwner), [drmOwner]);

  const count = state.tiles.length;
  const layout = effectiveLayout(state.layout, count);
  const rects = useMemo(() => tileRects(layout, count, area.width, area.height, GAP), [layout, count, area.width, area.height]);
  const audioKey = audioKeyOf(state);
  const playing = focused && appActive;

  const explain = (result: TileResult) => {
    if (result.ok) return;
    if (result.error === DRM_LIMIT_MESSAGE) showAppDialog({title: 'One protected channel at a time', message: result.error, variant: 'warning'});
    else ToastAndroid.show(result.error, ToastAndroid.LONG);
  };

  const onPick = (channel: GridChannel) => {
    const mode = picker;
    setPicker(undefined);
    if (!mode) return;
    const saved = toSaved(channel, channel.sourceId);
    const known = knownProtectedChannels();
    const result = mode.mode === 'add' ? addTile(state, saved, {max, known}) : replaceTile(state, mode.key, saved, {known});
    if (result.ok) update(mode.mode === 'add' ? setAudio(result.state, result.key) : result.state);
    else explain(result);
  };

  const openFull = (tile: MultiTile) => {
    const channel = tile.channel as GridChannel;
    const result = openChannel(navigation, channel, sourceNameOf(channel.sourceId));
    result?.catch((err: any) => ToastAndroid.show(err?.message || 'Could not open this channel.', ToastAndroid.LONG));
  };

  const showMenu = (tile: MultiTile, failed: boolean) => {
    const index = state.tiles.findIndex(item => item.key === tile.key);
    const actions: {label: string; onPress?: () => void; variant?: 'default' | 'primary' | 'destructive'}[] = [{label: 'Cancel'}];
    if (failed) actions.push({label: 'Try again', onPress: () => setRetries(current => ({...current, [tile.key]: (current[tile.key] || 0) + 1}))});
    if (tile.key !== audioKey) actions.push({label: 'Hear this one', onPress: () => update(setAudio(state, tile.key))});
    actions.push({label: 'Change channel', onPress: () => setPicker({mode: 'replace', key: tile.key})});
    if (layout === 'big' && index > 0) actions.push({label: 'Swap with big tile', onPress: () => update(swapWithBig(state, tile.key))});
    actions.push({label: 'Remove', variant: 'destructive', onPress: () => update(removeTile(state, tile.key))});
    actions.push({label: 'Full screen', variant: 'primary', onPress: () => openFull(tile)});
    showAppDialog({title: tile.channel.name, message: tile.channel.group || 'Live TV channel', actions});
  };

  // A tap moves the sound to a tile; on the tile you already hear it opens the menu.
  const onTilePress = (tile: MultiTile, failed: boolean) => {
    if (tile.key !== audioKey && !failed) update(setAudio(state, tile.key));
    else showMenu(tile, failed);
  };

  const layouts = layoutsFor(count);
  const canAdd = count < max;

  return (
    <View style={{flex: 1, backgroundColor: '#000', paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: insets.bottom}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: isTV ? 32 : 8, paddingTop: isTV ? 16 : 4, paddingBottom: 6}}>
        <TVFocusable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} borderRadius={20} style={{padding: 6}}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#fff" />
        </TVFocusable>
        <AppText role="titleMedium" numberOfLines={1} style={{color: '#fff'}}>Multi-view</AppText>
        <AppText role="bodySmall" style={{color: 'rgba(255,255,255,0.7)'}}>{count} of {max}</AppText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: 1}} contentContainerStyle={{gap: 8, alignItems: 'center', paddingLeft: 4}}>
          {layouts.length > 1
            ? LAYOUT_CHIPS.filter(item => layouts.includes(item.id)).map(item => (
                <Chip key={item.id} label={item.label} icon={item.icon} selected={layout === item.id} onPress={() => update(setLayout(state, item.id))} />
              ))
            : null}
          {canAdd && count ? <Chip label="Add channel" icon="plus" onPress={() => setPicker({mode: 'add'})} /> : null}
        </ScrollView>
      </View>
      <View
        style={{flex: 1, marginHorizontal: isTV ? 32 : 4, marginBottom: isTV ? 24 : 4}}
        onLayout={event => {
          const {width, height} = event.nativeEvent.layout;
          setArea(current => (current.width === width && current.height === height ? current : {width, height}));
        }}>
        {!focused ? null : count ? (
          state.tiles.map((tile, index) =>
            rects[index] ? (
              <Tile
                key={tile.key}
                tile={tile}
                rect={rects[index]}
                quality={tileQuality(layout, count, index)}
                audio={tile.key === audioKey}
                playing={playing}
                drmOwner={drmOwner}
                preferred={tile.key === audioKey}
                retry={retries[tile.key] || 0}
                register={register}
                onDrm={onDrm}
                onPress={failed => onTilePress(tile, failed)}
                onLongPress={failed => showMenu(tile, failed)}
              />
            ) : null,
          )
        ) : (
          <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16}}>
            <MaterialCommunityIcons name="view-grid-outline" size={48} color="rgba(255,255,255,0.7)" />
            <AppText role="bodyLarge" style={{color: '#fff', textAlign: 'center'}}>Watch up to {max} channels at once.</AppText>
            <Button onPress={() => setPicker({mode: 'add'})} hasTVPreferredFocus accessibilityLabel="Add a channel">Add a channel</Button>
          </View>
        )}
      </View>
      {count && !isTV ? (
        <AppText role="bodySmall" style={{color: 'rgba(255,255,255,0.7)', textAlign: 'center', paddingBottom: 6}}>
          Tap a tile to hear it. Tap it again for more.
        </AppText>
      ) : null}
      <MultiViewPicker
        visible={!!picker}
        title={picker?.mode === 'replace' ? 'Change channel' : 'Add a channel'}
        onPick={onPick}
        onClose={() => setPicker(undefined)}
      />
    </View>
  );
};

export default MultiView;

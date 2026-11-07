import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, Image, ScrollView, ToastAndroid, View, useWindowDimensions, type TextInputInstance} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import {TVFocusable} from '../../components/tv';
import Button from '../../components/ui/Button';
import KeyboardForm from '../../components/ui/KeyboardForm';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {isTV} from '../../lib/tv';
import {canLoadEpg, loadNowNext, type NowNext} from '../../lib/livetv/epg';
import {channelGroups} from '../../lib/livetv/m3u';
import {applyFilters, channelFacets, displayChannelName, filterCounts, type ChannelFilters} from '../../lib/livetv/filters';
import {JIO_SOURCE_ID, loadJioChannels} from '../../lib/livetv/jio/channels';
import {jioSignedInNumber, sendOtp, signOutJio, verifyOtp} from '../../lib/livetv/jio/session';
import {
  addPlaylist,
  getChannelFilters,
  getJioServer,
  jioEpgUrl,
  listFavourites,
  listPlaylists,
  listRecent,
  listSources,
  loadPlaylist,
  readCachedPlaylist,
  removePlaylist,
  setChannelFilters,
  setJioServer,
  toggleFavourite,
  type JioQuality,
  type LiveSource,
} from '../../lib/livetv/store';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {openChannel, type GridChannel} from './play';
import {showChannelMenu} from './record';
import ChannelFilterBar, {QualityBadge} from './ChannelFilterBar';
import {isKidsChannelGroup} from '../../lib/profiles/kids';
import {flagOf, findCountry} from '../../lib/livetv/countries';
import {detectCountry, DETECTED_FROM} from '../../lib/livetv/deviceCountry';
import {
  findSource,
  getSavedLiveView,
  initialLiveView,
  listRecentCountries,
  pickCountry,
  saveLiveView,
  worldChipCountry,
  worldCountryOf,
  worldSource,
  worldSourceId,
} from '../../lib/livetv/world';
import CountryPicker from './CountryPicker';
import {useIsKidsProfile} from '../../lib/profiles/useProfiles';

export {openChannel};

type Section = 'favourites' | 'recent' | string;
type Mode = 'grid' | 'jiotv' | 'add' | 'country';

const IPTV_ORG_NOTE = 'Publicly listed free-to-air channels from iptv-org. Availability varies and some streams may not play.';
const JIOTV_NOTE = 'jiotv_go runs on your PC or phone (Termux) and signs in with your own Jio number. Enter its address here.';
const JIO_NOTE = 'Sign in with your Jio mobile number to watch JioTV channels here. Droid Stream is not affiliated with Jio.';
const QUALITIES: JioQuality[] = ['auto', 'low', 'medium', 'high'];

/** Now / next for the shown channels. Skips gzipped or large guides. */
const useNowNext = (epgUrl: string | undefined, channels: GridChannel[]) => {
  const [guide, setGuide] = useState<Map<string, NowNext>>(() => new Map());
  const ids = useMemo(() => channels.map(channel => channel.tvgId).filter(Boolean).join(','), [channels]);
  useEffect(() => {
    setGuide(new Map());
    if (!canLoadEpg(epgUrl) || !ids) return;
    let alive = true;
    loadNowNext(epgUrl, new Set(ids.split(',')))
      .then(result => alive && setGuide(result))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [epgUrl, ids]);
  return guide;
};

const ChannelTile = ({channel, title, badge, width, favourite, now, preferred, busy, onPress, onLongPress}: {
  channel: GridChannel;
  /** The name as shown (without "(1080p)" when the badge is on). */
  title: string;
  badge?: string;
  width: number;
  favourite: boolean;
  now?: string;
  preferred: boolean;
  busy?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) => {
  const colors = useM3Colors();
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <TVFocusable
      accessibilityRole="button"
      accessibilityLabel={`Play ${channel.name}`}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onLongPress={onLongPress}
      borderRadius={14}
      focusScale={1.05}
      style={{width, margin: 4, padding: 8, borderRadius: 14, backgroundColor: colors.surfaceContainer}}>
      <View style={{height: width * 0.56, borderRadius: 10, backgroundColor: colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'}}>
        {channel.logo && !logoFailed ? (
          <Image source={{uri: channel.logo}} resizeMode="contain" onError={() => setLogoFailed(true)} style={{width: '80%', height: '80%'}} />
        ) : (
          <MaterialCommunityIcons name="television-classic" size={30} color={colors.onSurfaceVariant} />
        )}
        {badge ? <QualityBadge label={badge} /> : null}
        {busy ? <ActivityIndicator color={colors.primary} style={{position: 'absolute'}} /> : null}
        {favourite ? (
          <MaterialCommunityIcons name="star" size={16} color={colors.primary} style={{position: 'absolute', top: 4, right: 4}} />
        ) : null}
      </View>
      <AppText role="labelLarge" numberOfLines={1} style={{color: colors.onSurface, marginTop: 6}}>{title}</AppText>
      <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>{now || channel.group || ' '}</AppText>
    </TVFocusable>
  );
};

const LiveTV = ({navigation}: {navigation: any}) => {
  const colors = useM3Colors();
  const {width} = useWindowDimensions();
  const [sources, setSources] = useState<LiveSource[]>(() => listSources());
  const detected = useMemo(() => detectCountry(), []);
  // The list picked last; on first open, the detected country (see initialLiveView).
  const [view, setView] = useState<Section>(() =>
    initialLiveView({
      saved: getSavedLiveView(),
      validIds: ['favourites', 'recent', JIO_SOURCE_ID, ...sources.map(item => item.id)],
      hasFavourites: listFavourites().length > 0,
      detected: detected?.code,
    }),
  );
  // Every list opened after this one is remembered for next time.
  const firstView = useRef(view);
  useEffect(() => {
    if (view === firstView.current) return;
    firstView.current = '';
    saveLiveView(view);
  }, [view]);
  const [mode, setMode] = useState<Mode>('grid');
  const [channels, setChannels] = useState<GridChannel[]>([]);
  const [epgUrl, setEpgUrl] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  // Filter choices are saved per source and per profile.
  const [filterState, setFilterState] = useState(() => ({view, filters: getChannelFilters(view)}));
  if (filterState.view !== view) setFilterState({view, filters: getChannelFilters(view)});
  const filters = filterState.view === view ? filterState.filters : getChannelFilters(view);
  // Once a chip is used, new tiles stop taking TV focus away from the chips.
  const [chipsUsed, setChipsUsed] = useState(false);
  const [favourites, setFavourites] = useState(() => listFavourites());
  const [reload, setReload] = useState(0);

  // Form fields.
  const jio = getJioServer();
  const [address, setAddress] = useState(jio?.address || '');
  const [quality, setQuality] = useState<JioQuality>(jio?.quality || 'auto');
  const [playlistName, setPlaylistName] = useState('');
  const [playlistUrl, setPlaylistUrl] = useState('');
  const urlRef = useRef<TextInputInstance>(null);

  // Sign in with Jio.
  const [jioNumber, setJioNumber] = useState(() => jioSignedInNumber());
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [jioBusy, setJioBusy] = useState(false);
  const [jioError, setJioError] = useState('');
  const [opening, setOpening] = useState<string | undefined>();
  const otpRef = useRef<TextInputInstance>(null);

  const worldCountry = worldCountryOf(view);
  const source = sources.find(item => item.id === view) || worldSource(worldCountry);
  const sourceName = (id: string) => (id === JIO_SOURCE_ID ? 'JioTV' : findSource(id)?.name || 'Live TV');

  useFocusEffect(useCallback(() => setFavourites(listFavourites()), []));
  // The guide may have changed the filters.
  useFocusEffect(useCallback(() => setFilterState({view, filters: getChannelFilters(view)}), [view]));

  useEffect(() => {
    setError('');
    if (view === JIO_SOURCE_ID) {
      setEpgUrl(undefined);
      setChannels([]);
      if (!jioNumber) return;
      let alive = true;
      setLoading(true);
      loadJioChannels({force: reload > 0})
        .then(list => alive && setChannels(list.map(channel => ({...channel, sourceId: JIO_SOURCE_ID}))))
        .catch(err => {
          if (!alive) return;
          if (err?.name === 'JioAuthError') setJioNumber(undefined);
          setError(err?.message || 'Could not load JioTV channels.');
        })
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }
    if (view === 'favourites' || view === 'recent') {
      setEpgUrl(undefined);
      setChannels(view === 'favourites' ? listFavourites() : listRecent());
      return;
    }
    if (!source) return;
    const cached = readCachedPlaylist(source);
    setChannels(cached ? cached.playlist.channels.map(channel => ({...channel, sourceId: source.id})) : []);
    let alive = true;
    setLoading(true);
    loadPlaylist(source, {force: reload > 0})
      .then(result => {
        if (!alive) return;
        setChannels(result.playlist.channels.map(channel => ({...channel, sourceId: source.id})));
        setEpgUrl(result.playlist.epgUrl || (source.kind === 'jiotv' && jio ? jioEpgUrl(jio) : undefined));
      })
      .catch(err => alive && setError(err?.message || 'Could not load this playlist.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [view, source?.id, source?.url, reload, jioNumber]);

  // A kids profile keeps only kids, animation and cartoon groups.
  const kids = useIsKidsProfile();
  const allowed = useMemo(() => (kids ? channels.filter(channel => isKidsChannelGroup(channel.group)) : channels), [channels, kids]);
  const groups = useMemo(() => channelGroups(allowed), [allowed]);
  // A saved group the list no longer has is ignored.
  const group = filters.group && groups.includes(filters.group) ? filters.group : undefined;
  const effective = useMemo<ChannelFilters>(() => ({...filters, group}), [filters, group]);
  const shown = useMemo(() => applyFilters(allowed, effective, query), [allowed, effective, query]);
  const counts = useMemo(() => filterCounts(allowed, effective, query), [allowed, effective, query]);
  const updateFilters = (next: ChannelFilters) => {
    setChipsUsed(true);
    setFilterState({view, filters: next});
    setChannelFilters(view, next);
  };
  const guide = useNowNext(epgUrl, shown.length > 400 ? [] : shown);
  const favouriteKeys = useMemo(() => new Set(favourites.map(item => `${item.sourceId}|${item.id}`)), [favourites]);

  const columns = isTV ? 6 : Math.max(2, Math.floor((width - 24) / 120));
  const tileWidth = Math.floor((width - (isTV ? 96 : 24)) / columns) - 8;

  const onToggleFavourite = (channel: GridChannel) => {
    const added = toggleFavourite(channel, channel.sourceId);
    setFavourites(listFavourites());
    if (view === 'favourites') setChannels(listFavourites());
    ToastAndroid.show(added ? `${channel.name} added to favourites` : `${channel.name} removed from favourites`, ToastAndroid.SHORT);
  };

  const runJio = async (step: () => Promise<void>) => {
    if (jioBusy) return;
    setJioBusy(true);
    setJioError('');
    try {
      await step();
    } catch (err: any) {
      setJioError(err?.message || 'Something went wrong. Try again.');
    } finally {
      setJioBusy(false);
    }
  };

  const onSendOtp = () =>
    runJio(async () => {
      await sendOtp(phone);
      setOtp('');
      setOtpSent(true);
      setTimeout(() => otpRef.current?.focus(), 50);
    });

  const onVerifyOtp = () =>
    runJio(async () => {
      const session = await verifyOtp(phone, otp);
      setOtp('');
      setPhone('');
      setOtpSent(false);
      setJioNumber(session.number);
    });

  const onSignOutJio = async () => {
    await signOutJio();
    setJioNumber(undefined);
    setChannels([]);
    setOtpSent(false);
  };

  const onPlay = (channel: GridChannel) => {
    if (opening) return;
    const result = openChannel(navigation, channel, sourceName(channel.sourceId));
    if (!result) return;
    setOpening(channel.id);
    result
      .catch((err: any) => {
        if (err?.name === 'JioAuthError') setJioNumber(undefined);
        ToastAndroid.show(err?.message || 'Could not open this channel.', ToastAndroid.LONG);
      })
      .finally(() => setOpening(undefined));
  };

  const saveJio = () => {
    const saved = setJioServer(address, quality);
    setSources(listSources());
    setMode('grid');
    if (saved) {
      setAddress(saved.address);
      setView('jiotv');
      setReload(value => value + 1);
    } else if (view === 'jiotv') {
      setView('iptv-org');
    }
  };

  const savePlaylist = () => {
    try {
      const playlist = addPlaylist(playlistName, playlistUrl);
      setPlaylistName('');
      setPlaylistUrl('');
      setSources(listSources());
      setMode('grid');
      setView(playlist.id);
    } catch (err: any) {
      ToastAndroid.show(err?.message || 'Could not add this playlist.', ToastAndroid.SHORT);
    }
  };

  // World opens the country picked last (or the detected one); with neither, the country list.
  const openWorld = () => {
    const code = worldCountry || worldChipCountry(detected?.code);
    const id = worldSourceId(code);
    if (id) {
      setMode('grid');
      setView(id);
    } else {
      setMode('country');
    }
  };

  const onPickCountry = (code: string) => {
    const id = pickCountry(code);
    setMode('grid');
    if (id) setView(id);
  };

  const inputStyle = {backgroundColor: colors.surfaceContainerHigh, color: colors.onSurface, borderRadius: 12, paddingHorizontal: 14, minHeight: 52, fontSize: 16, marginTop: 8};

  const header = (
    <View style={{paddingHorizontal: isTV ? 40 : 12, paddingTop: isTV ? 24 : 12}}>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Live TV</AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingVertical: 12}}>
        <Chip label="Favourites" icon="star-outline" selected={mode === 'grid' && view === 'favourites'} onPress={() => { setMode('grid'); setView('favourites'); }} />
        <Chip label="Recent" icon="history" selected={mode === 'grid' && view === 'recent'} onPress={() => { setMode('grid'); setView('recent'); }} />
        {sources.map(item => (
          <Chip
            key={item.id}
            label={item.name}
            icon={item.kind === 'iptv-org' ? 'earth' : item.kind === 'jiotv' ? 'server-network' : 'playlist-play'}
            selected={mode === 'grid' && view === item.id}
            onPress={() => { setMode('grid'); setView(item.id); }}
            onLongPress={item.kind === 'jiotv' && !kids ? () => setMode('jiotv') : undefined}
          />
        ))}
        {kids && !jioNumber ? null : <Chip label="JioTV" icon="cellphone-key" selected={mode === 'grid' && view === JIO_SOURCE_ID} onPress={() => { setMode('grid'); setView(JIO_SOURCE_ID); }} />}
        <Chip label="World" icon="web" selected={mode === 'country' || (mode === 'grid' && !!worldCountry)} onPress={openWorld} />
        {/* Server and playlist setup is not shown on a kids profile. */}
        {kids ? null : <Chip label={jio ? 'JioTV Go settings' : 'JioTV Go server'} icon="cog-outline" selected={mode === 'jiotv'} onPress={() => setMode('jiotv')} />}
        {kids ? null : <Chip label="Add playlist" icon="plus" selected={mode === 'add'} onPress={() => setMode('add')} />}
      </ScrollView>
    </View>
  );

  if (mode === 'jiotv') {
    return (
      <View style={{flex: 1, backgroundColor: colors.background}}>
        {header}
        <KeyboardForm contentContainerStyle={{paddingHorizontal: isTV ? 40 : 12, paddingBottom: 96}}>
          <AppText role="titleMedium" style={{color: colors.onSurface}}>JioTV Go server</AppText>
          <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>{JIOTV_NOTE}</AppText>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="http://192.168.1.5:5001"
            placeholderTextColor={colors.onSurfaceVariant}
            accessibilityLabel="JioTV Go server address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={saveJio}
            style={inputStyle}
          />
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 6}}>Port 5001 is added when you leave it out. The app loads /playlist.m3u from this server.</AppText>
          <AppText role="labelLarge" style={{color: colors.onSurface, marginTop: 16, marginBottom: 8}}>Quality</AppText>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
            {QUALITIES.map(item => <Chip key={item} label={item === 'auto' ? 'Auto' : item[0].toUpperCase() + item.slice(1)} selected={quality === item} onPress={() => setQuality(item)} />)}
          </View>
          <View style={{flexDirection: 'row', gap: 8, marginTop: 20}}>
            <Button onPress={saveJio} accessibilityLabel="Save server">Save</Button>
            {jio ? <Button variant="outlined" onPress={() => { setAddress(''); setJioServer(''); setSources(listSources()); setMode('grid'); setView('iptv-org'); }} accessibilityLabel="Remove server">Remove</Button> : null}
          </View>
        </KeyboardForm>
      </View>
    );
  }

  if (mode === 'grid' && view === JIO_SOURCE_ID && !jioNumber) {
    return (
      <View style={{flex: 1, backgroundColor: colors.background}}>
        {header}
        <KeyboardForm contentContainerStyle={{paddingHorizontal: isTV ? 40 : 12, paddingBottom: 96}}>
          <AppText role="titleMedium" style={{color: colors.onSurface}}>Sign in with Jio</AppText>
          <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>{JIO_NOTE}</AppText>
          <AppText role="labelLarge" style={{color: colors.onSurface, marginTop: 16}}>Jio mobile number</AppText>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <AppText role="bodyLarge" style={{color: colors.onSurfaceVariant, marginTop: 8}}>+91</AppText>
            <TextInput
              value={phone}
              onChangeText={value => {
                setPhone(value);
                if (otpSent) setOtpSent(false);
              }}
              placeholder="98765 43210"
              placeholderTextColor={colors.onSurfaceVariant}
              accessibilityLabel="Jio mobile number"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={16}
              returnKeyType={otpSent ? 'next' : 'go'}
              submitBehavior={otpSent ? 'submit' : undefined}
              onSubmitEditing={() => (otpSent ? otpRef.current?.focus() : onSendOtp())}
              editable={!jioBusy}
              style={[inputStyle, {flex: 1}]}
            />
          </View>
          {otpSent ? (
            <>
              <AppText role="labelLarge" style={{color: colors.onSurface, marginTop: 16}}>Code from the SMS</AppText>
              <TextInput
                ref={otpRef}
                value={otp}
                onChangeText={setOtp}
                placeholder="6-digit code"
                placeholderTextColor={colors.onSurfaceVariant}
                accessibilityLabel="SMS code"
                keyboardType="number-pad"
                autoComplete="sms-otp"
                textContentType="oneTimeCode"
                maxLength={8}
                returnKeyType="go"
                onSubmitEditing={onVerifyOtp}
                editable={!jioBusy}
                style={inputStyle}
              />
            </>
          ) : null}
          {jioError ? <AppText role="bodyMedium" accessibilityLiveRegion="polite" style={{color: colors.error, marginTop: 12}}>{jioError}</AppText> : null}
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20}}>
            {otpSent ? (
              <>
                <Button onPress={onVerifyOtp} accessibilityLabel="Verify code">Verify</Button>
                <Button variant="outlined" onPress={onSendOtp} accessibilityLabel="Send a new code">Send again</Button>
              </>
            ) : (
              <Button onPress={onSendOtp} accessibilityLabel="Send OTP">Send OTP</Button>
            )}
            {jioBusy ? <ActivityIndicator color={colors.primary} /> : null}
          </View>
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 16}}>
            JioTV texts a code to this number. The sign-in stays encrypted on this device and is never backed up. Free channels work without signing in.
          </AppText>
        </KeyboardForm>
      </View>
    );
  }

  if (mode === 'country') {
    return (
      <CountryPicker
        header={header}
        detected={detected}
        current={worldCountry || worldChipCountry(detected?.code)}
        recent={listRecentCountries()}
        onPick={onPickCountry}
      />
    );
  }

  if (mode === 'add') {
    const playlists = listPlaylists();
    return (
      <View style={{flex: 1, backgroundColor: colors.background}}>
        {header}
        <KeyboardForm contentContainerStyle={{paddingHorizontal: isTV ? 40 : 12, paddingBottom: 96}}>
          <AppText role="titleMedium" style={{color: colors.onSurface}}>Add an M3U playlist</AppText>
          <TextInput
            value={playlistName}
            onChangeText={setPlaylistName}
            placeholder="Name"
            placeholderTextColor={colors.onSurfaceVariant}
            accessibilityLabel="Playlist name"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => urlRef.current?.focus()}
            style={inputStyle}
          />
          <TextInput
            ref={urlRef}
            value={playlistUrl}
            onChangeText={setPlaylistUrl}
            placeholder="https://example.com/playlist.m3u"
            placeholderTextColor={colors.onSurfaceVariant}
            accessibilityLabel="Playlist address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={savePlaylist}
            style={inputStyle}
          />
          <View style={{flexDirection: 'row', marginTop: 16}}>
            <Button onPress={savePlaylist} accessibilityLabel="Add playlist">Add</Button>
          </View>
          {playlists.length ? <AppText role="titleMedium" style={{color: colors.onSurface, marginTop: 24, marginBottom: 8}}>Your playlists</AppText> : null}
          {playlists.map(item => (
            <View key={item.id} style={{flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainer, borderRadius: 12, padding: 12, marginBottom: 8}}>
              <View style={{flex: 1}}>
                <AppText role="bodyLarge" numberOfLines={1} style={{color: colors.onSurface}}>{item.name}</AppText>
                <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>{item.url}</AppText>
              </View>
              <Chip label="Remove" icon="delete-outline" accessibilityLabel={`Remove ${item.name}`} onPress={() => { removePlaylist(item.id); setSources(listSources()); if (view === item.id) setView('iptv-org'); }} />
            </View>
          ))}
        </KeyboardForm>
      </View>
    );
  }

  const isJio = view === JIO_SOURCE_ID;
  const note = source?.kind === 'iptv-org' || source?.kind === 'world' ? IPTV_ORG_NOTE : source?.kind === 'jiotv' ? JIOTV_NOTE : undefined;
  const empty = view === 'favourites'
    ? 'No favourites yet. Long-press a channel to add it.'
    : view === 'recent'
      ? 'Channels you watch show up here.'
      : loading
        ? ''
        : error || 'No channels match.';

  return (
    <View style={{flex: 1, backgroundColor: colors.background}}>
      <FlatList
        key={columns}
        data={shown}
        numColumns={columns}
        keyExtractor={item => `${item.sourceId}|${item.id}`}
        contentContainerStyle={{paddingHorizontal: isTV ? 36 : 8, paddingBottom: 96}}
        initialNumToRender={columns * 4}
        windowSize={7}
        removeClippedSubviews={!isTV}
        ListHeaderComponent={
          <View style={{marginHorizontal: isTV ? -36 : -8}}>
            {header}
            <View style={{paddingHorizontal: isTV ? 40 : 12}}>
              {worldCountry ? (
                <View style={{flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8}}>
                  <AppText role="titleMedium" style={{flexShrink: 1, color: colors.onSurface}}>
                    {flagOf(worldCountry)} {findCountry(worldCountry)?.name}
                    {detected?.code === worldCountry ? <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant}}> · {DETECTED_FROM[detected.from]}</AppText> : null}
                  </AppText>
                  <TVFocusable accessibilityRole="button" accessibilityLabel="Change country" onPress={() => setMode('country')} borderRadius={20} style={{flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.surfaceContainerHigh}}>
                    <MaterialCommunityIcons name="web" size={18} color={colors.onSurfaceVariant} />
                    <AppText role="labelLarge" style={{color: colors.onSurface}}>Change country</AppText>
                  </TVFocusable>
                </View>
              ) : null}
              {note ? <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>{note}</AppText> : null}
              {isJio && jioNumber ? (
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8}}>
                  <AppText role="bodyMedium" style={{flex: 1, color: colors.onSurfaceVariant}}>Signed in as {jioNumber}</AppText>
                  <Button variant="outlined" onPress={onSignOutJio} accessibilityLabel="Sign out of Jio">Sign out</Button>
                </View>
              ) : null}
              <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerHigh, borderRadius: 28, minHeight: 48, paddingHorizontal: 16}}>
                <MaterialCommunityIcons name="magnify" size={22} color={colors.onSurfaceVariant} />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search channels" placeholderTextColor={colors.onSurfaceVariant} accessibilityLabel="Search channels" returnKeyType="search" style={{flex: 1, color: colors.onSurface, marginLeft: 8, fontSize: 16}} />
                {source || (isJio && jioNumber) ? (
                  <TVFocusable accessibilityRole="button" accessibilityLabel="Open the TV guide" onPress={() => navigation.navigate('LiveGuide', {sourceId: view})} borderRadius={20} style={{padding: 6}}>
                    <MaterialCommunityIcons name="television-guide" size={22} color={colors.onSurfaceVariant} />
                  </TVFocusable>
                ) : null}
                {source || isJio ? (
                  <TVFocusable accessibilityRole="button" accessibilityLabel="Reload playlist" onPress={() => setReload(value => value + 1)} borderRadius={20} style={{padding: 6}}>
                    <MaterialCommunityIcons name="refresh" size={22} color={colors.onSurfaceVariant} />
                  </TVFocusable>
                ) : null}
              </View>
              {groups.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingTop: 12}}>
                  <Chip label="All" count={counts.allGroups} selected={!group} onPress={() => updateFilters({...filters, group: undefined})} />
                  {groups.map(item => (
                    <Chip key={item} label={item} count={counts.groups.get(item) || 0} selected={group === item} onPress={() => updateFilters({...filters, group: item})} />
                  ))}
                </ScrollView>
              ) : null}
              {allowed.length ? (
                <ChannelFilterBar
                  filters={effective}
                  counts={counts}
                  shown={shown.length}
                  total={allowed.length}
                  onChange={updateFilters}
                  onTouch={() => setChipsUsed(true)}
                />
              ) : null}
              {loading && !channels.length ? <ActivityIndicator color={colors.primary} style={{marginTop: 24}} /> : null}
              {error && channels.length ? <AppText role="bodySmall" style={{color: colors.error, marginTop: 8}}>{error}</AppText> : null}
            </View>
            <View style={{height: 12}} />
          </View>
        }
        ListEmptyComponent={empty ? <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, paddingHorizontal: 4}}>{empty}</AppText> : undefined}
        renderItem={({item, index}) => (
          <ChannelTile
            channel={item}
            title={filters.qualityBadge ? displayChannelName(item.name) : item.name}
            badge={filters.qualityBadge ? channelFacets(item).quality : undefined}
            width={tileWidth}
            favourite={favouriteKeys.has(`${item.sourceId}|${item.id}`)}
            now={item.tvgId ? guide.get(item.tvgId)?.now?.title : undefined}
            preferred={index === 0 && !chipsUsed}
            busy={opening === item.id}
            onPress={() => onPlay(item)}
            onLongPress={() => showChannelMenu(item, favouriteKeys.has(`${item.sourceId}|${item.id}`), () => onToggleFavourite(item))}
          />
        )}
      />
    </View>
  );
};

export default LiveTV;

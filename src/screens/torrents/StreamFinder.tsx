import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Clipboard, FlatList, Image, Pressable, ScrollView, Switch, View} from 'react-native';
import {RawTextInput as TextInput} from '../../components/ui/Text';
import Chip from '../../components/torrentSearch/Chip';
import TitleMatches from '../../components/torrentSearch/TitleMatches';
import {TVFocusable} from '../../components/tv';
import AppText from '../../components/ui/Text';
import {getService} from '../../lib/debrid';
import {findImdb, fetchMeta, readAddons, type StremioMeta} from '../../lib/stremio';
import {cachedCandidates, findSources, readPrefs, writePrefs, type Candidate, type FinderPrefs, type FinderStatus, type WantedVideo} from '../../lib/streams/finder';
import {playCandidate} from '../../lib/streams/play';
import {downloadWithClient, toast} from '../../lib/torrentSearch/actions';
import {candidateToResult} from '../../lib/streams/finder';
import {formatBytes} from '../../lib/torrentSearch/util';
import {useM3Colors} from '../../theme/M3PaletteContext';

const RESOLUTIONS: FinderPrefs['maxResolution'][] = ['2160p', '1080p', '720p', '480p'];

const StreamFinder = ({navigation, route}: {navigation: any; route?: {params?: WantedVideo}}) => {
  const colors = useM3Colors();
  const initial = route?.params;
  const [want, setWant] = useState<WantedVideo | undefined>(initial);
  const [query, setQuery] = useState(initial?.title || '');
  const [kind, setKind] = useState<'movie' | 'series'>(initial?.type || 'movie');
  const [meta, setMeta] = useState<StremioMeta>();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [status, setStatus] = useState<Record<string, FinderStatus>>({});
  const [busy, setBusy] = useState<string>();
  const [prefs, setPrefs] = useState<FinderPrefs>(readPrefs);
  const [showPrefs, setShowPrefs] = useState(false);
  const runId = useRef(0);

  const seasons = useMemo(
    () => Array.from(new Set((meta?.videos || []).map(video => video.season).filter((season): season is number => typeof season === 'number' && season > 0))).sort((a, b) => a - b),
    [meta],
  );
  const episodes = useMemo(
    () => (meta?.videos || []).filter(video => video.season === want?.season).sort((a, b) => (a.episode || 0) - (b.episode || 0)),
    [meta, want?.season],
  );
  const nextEpisode = useMemo((): WantedVideo | undefined => {
    if (!want || want.type !== 'series' || want.episode === undefined) return undefined;
    const list = (meta?.videos || []).filter(video => (video.season || 0) > 0).sort((a, b) => (a.season! - b.season!) || (a.episode! - b.episode!));
    const index = list.findIndex(video => video.season === want.season && video.episode === want.episode);
    const next = index >= 0 ? list[index + 1] : undefined;
    return next ? {...want, season: next.season, episode: next.episode} : undefined;
  }, [meta, want]);

  const search = useCallback(async (target: WantedVideo) => {
    const id = ++runId.current;
    const remembered = cachedCandidates(target);
    setCandidates(remembered || []);
    setStatus({});
    await findSources(target, (ranked, nextStatus) => {
      if (runId.current !== id) return;
      setCandidates(ranked);
      setStatus(nextStatus);
    }).catch(error => toast(error.message));
  }, []);

  const identify = useCallback(async (target: WantedVideo) => {
    let resolved = target;
    try {
      if (!resolved.imdbId) {
        const found = await findImdb(resolved.title, resolved.type, resolved.year);
        if (found) resolved = {...resolved, imdbId: found.id, poster: resolved.poster || found.poster, year: resolved.year || Number(String(found.releaseInfo || '').slice(0, 4)) || undefined};
      }
      if (resolved.imdbId && resolved.type === 'series') {
        const full = await fetchMeta('series', resolved.imdbId);
        setMeta(full);
        if (resolved.season === undefined) {
          const firstVideo = (full?.videos || []).filter(video => (video.season || 0) > 0).sort((a, b) => (a.season! - b.season!) || (a.episode! - b.episode!))[0];
          resolved = {...resolved, season: firstVideo?.season ?? 1, episode: firstVideo?.episode ?? 1};
        }
      } else if (resolved.imdbId) {
        setMeta(await fetchMeta('movie', resolved.imdbId).catch(() => undefined));
      }
    } catch {
      // Without Cinemeta the torrent sites still work by title.
    }
    setWant(resolved);
    search(resolved);
  }, [search]);

  useEffect(() => {
    if (initial?.title) identify(initial);
    // Only on open.
  }, []);

  const play = async (candidate: Candidate, forcePhone = false) => {
    if (!want) return;
    setBusy('Starting…');
    try {
      await playCandidate(candidate, want, navigation, {next: nextEpisode, onStatus: setBusy, forcePhone});
    } catch (error: any) {
      toast(error?.message || 'Could not play this source');
    } finally {
      setBusy(undefined);
    }
  };

  const savePrefs = (next: FinderPrefs) => {
    setPrefs(next);
    writePrefs(next);
  };

  const states = Object.values(status);
  const loading = states.some(item => item.state === 'loading') || (want && !states.length);
  const best = candidates[0];

  return (
    <View style={{flex: 1, backgroundColor: colors.background}}>
      <FlatList
        data={candidates}
        keyExtractor={item => item.id}
        contentContainerStyle={{padding: 16, paddingBottom: 96}}
        ListHeaderComponent={
          <View>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} hitSlop={8} style={{minWidth: 40, minHeight: 48, justifyContent: 'center'}}>
                <MaterialCommunityIcons name="arrow-left" size={24} color={colors.onSurface} />
              </Pressable>
              <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground, flex: 1}}>Find streams</AppText>
              <Pressable accessibilityRole="button" accessibilityLabel="Stremio add-ons" onPress={() => navigation.navigate('StremioAddons')} hitSlop={8} style={{minWidth: 40, minHeight: 48, alignItems: 'center', justifyContent: 'center'}}>
                <MaterialCommunityIcons name="puzzle" size={24} color={readAddons().length ? colors.primary : colors.onSurfaceVariant} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Stream preferences" onPress={() => setShowPrefs(value => !value)} hitSlop={8} style={{minWidth: 40, minHeight: 48, alignItems: 'center', justifyContent: 'center'}}>
                <MaterialCommunityIcons name="tune-variant" size={24} color={colors.onSurfaceVariant} />
              </Pressable>
            </View>

            <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerHigh, borderRadius: 28, paddingHorizontal: 16, minHeight: 52, marginTop: 8}}>
              <MaterialCommunityIcons name="magnify" size={22} color={colors.onSurfaceVariant} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Movie or show name" placeholderTextColor={colors.onSurfaceVariant} accessibilityLabel="Title to find"
                returnKeyType="search" onSubmitEditing={() => query.trim() && identify({title: query.trim(), type: kind})} style={{flex: 1, color: colors.onSurface, marginLeft: 8, fontSize: 16}} />
            </View>
            <View style={{flexDirection: 'row', gap: 8, marginTop: 8}}>
              <Chip label="Movie" icon="movie-open" selected={kind === 'movie'} onPress={() => setKind('movie')} />
              <Chip label="Series" icon="television-classic" selected={kind === 'series'} onPress={() => setKind('series')} />
            </View>

            <TitleMatches
              query={want?.title || ''}
              selectedId={want?.imdbId}
              onPick={({meta: picked, type}) => {
                setKind(type);
                setQuery(picked.name);
                identify({title: picked.name, type, imdbId: picked.id, poster: picked.poster, year: Number(String(picked.releaseInfo || picked.year || '').slice(0, 4)) || undefined});
              }}
            />

            {showPrefs ? (
              <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 16, padding: 12, marginTop: 12, gap: 8}}>
                <AppText role="labelLarge" style={{color: colors.onSurfaceVariant}}>Best quality to pick</AppText>
                <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
                  {RESOLUTIONS.map(res => <Chip key={res} label={res === '2160p' ? '4K' : res} selected={prefs.maxResolution === res} onPress={() => savePrefs({...prefs, maxResolution: res})} />)}
                </View>
                <TextInput accessibilityLabel="Preferred audio language" placeholder="Preferred language, e.g. Hindi" placeholderTextColor={colors.outline} defaultValue={prefs.preferredLanguage}
                  onEndEditing={event => savePrefs({...prefs, preferredLanguage: event.nativeEvent.text.trim()})} style={{color: colors.onSurface, minHeight: 44, borderBottomWidth: 1, borderColor: colors.outlineVariant}} />
                {([
                  ['avoidCam', 'Skip CAM and TS copies'],
                  ['debridForUncached', 'Use my debrid for torrents that are not cached'],
                  ['preloadNext', 'Prepare the next episode in the background'],
                  ['includeSites', 'Also search the torrent sites'],
                ] as [keyof FinderPrefs, string][]).map(([key, text]) => (
                  <View key={key} style={{flexDirection: 'row', alignItems: 'center', minHeight: 48}}>
                    <AppText role="bodyMedium" style={{color: colors.onSurface, flex: 1}}>{text}</AppText>
                    <Switch accessibilityLabel={text} value={Boolean(prefs[key])} onValueChange={value => savePrefs({...prefs, [key]: value})} thumbColor={prefs[key] ? colors.primary : undefined} />
                  </View>
                ))}
              </View>
            ) : null}

            {want ? (
              <View style={{flexDirection: 'row', marginTop: 16}}>
                {want.poster || meta?.poster ? <Image source={{uri: want.poster || meta?.poster}} style={{width: 80, height: 120, borderRadius: 12, marginRight: 12, backgroundColor: colors.surfaceContainerHighest}} /> : null}
                <View style={{flex: 1}}>
                  <AppText role="titleLarge" style={{color: colors.onSurface}}>{meta?.name || want.title}</AppText>
                  <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant}}>
                    {[want.year || meta?.releaseInfo, want.imdbId, want.type === 'series' && want.season !== undefined ? `S${want.season} · E${want.episode}` : ''].filter(Boolean).join(' · ')}
                  </AppText>
                  {best ? (
                    <TVFocusable accessibilityRole="button" accessibilityLabel="Play best source" onPress={() => play(best)} hasTVPreferredFocus borderRadius={20}
                      style={{flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 20, paddingHorizontal: 20, minHeight: 48, marginTop: 12}}>
                      <MaterialCommunityIcons name="play" size={22} color={colors.onPrimary} />
                      <AppText role="labelLarge" style={{color: colors.onPrimary, marginLeft: 8}}>Play best</AppText>
                    </TVFocusable>
                  ) : null}
                </View>
              </View>
            ) : (
              <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 16}}>
                Type a title. Droid Stream finds it on Cinemeta, then asks your Stremio add-ons, the torrent sites, and your debrid caches at once, and plays the best source.
              </AppText>
            )}

            {want?.type === 'series' && seasons.length ? (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingVertical: 8, marginTop: 8}}>
                  {seasons.map(season => (
                    <Chip key={season} label={`Season ${season}`} selected={want.season === season} onPress={() => { const next = {...want, season, episode: 1}; setWant(next); search(next); }} />
                  ))}
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingBottom: 8}}>
                  {episodes.map(video => (
                    <Chip key={video.id} label={`E${video.episode}${video.name || video.title ? ` · ${(video.name || video.title)!.slice(0, 18)}` : ''}`} selected={want.episode === video.episode}
                      onPress={() => { const next = {...want, episode: video.episode}; setWant(next); search(next); }} />
                  ))}
                </ScrollView>
              </>
            ) : null}

            {states.length ? (
              <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginTop: 12}}>
                {states.map(item => `${item.label}: ${item.state === 'loading' ? '…' : item.state === 'error' ? 'failed' : item.count}`).join(' · ')}
              </AppText>
            ) : null}
            {want && !readAddons().length ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Add Stremio add-ons" onPress={() => navigation.navigate('StremioAddons')} style={{minHeight: 44, justifyContent: 'center'}}>
                <AppText style={{color: colors.primary}}>Add Stremio add-ons like Torrentio for more sources</AppText>
              </Pressable>
            ) : null}
            {loading ? <ActivityIndicator color={colors.primary} style={{marginVertical: 12}} /> : null}
          </View>
        }
        renderItem={({item, index}) => (
          <TVFocusable accessibilityRole="button" accessibilityLabel={`Play ${item.title}`} onPress={() => play(item)} onLongPress={() => play(item, true)} borderRadius={16}
            style={{backgroundColor: colors.surfaceContainer, borderRadius: 16, padding: 14, marginTop: 8, borderWidth: index === 0 ? 1.5 : 0, borderColor: colors.primary}}>
            {index === 0 ? <AppText role="labelMedium" style={{color: colors.primary, marginBottom: 4}}>BEST MATCH</AppText> : null}
            <AppText role="titleSmall" numberOfLines={2} style={{color: colors.onSurface}}>{item.title}</AppText>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6}}>
              {item.debridDirect ? <Chip label="Debrid ready" icon="lightning-bolt" tone="good" /> : null}
              {item.cachedOn.map(id => <Chip key={id} label={`${getService(id).name} cached`} icon="lightning-bolt" tone="good" />)}
              {item.resolution ? <Chip label={item.resolution === '2160p' ? '4K' : item.resolution} /> : null}
              {item.lowQuality ? <Chip label="CAM" tone="warn" /> : null}
              {item.languages.slice(0, 2).map(lang => <Chip key={lang} label={lang} />)}
            </View>
            <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginTop: 6}}>
              {[item.kind !== 'torrent' ? 'Direct link' : item.torrentUrl && !item.seeders ? 'Web seeded' : `${item.seeders} seeders`, item.sizeBytes ? formatBytes(item.sizeBytes) : '', item.origin].filter(Boolean).join(' · ')}
            </AppText>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10}}>
              {item.kind === 'torrent' ? (
                <>
                  <Chip label="On phone" icon="cellphone-play" accessibilityLabel="Play on this phone" onPress={() => play(item, true)} />
                  <Chip label="Download" icon="download" accessibilityLabel="Download torrent" onPress={() => downloadWithClient(candidateToResult(item)).catch(error => toast(error.message))} />
                </>
              ) : null}
              <Chip label="Copy" icon="content-copy" accessibilityLabel="Copy link" onPress={() => { Clipboard.setString(item.url || item.magnet || item.torrentUrl || ''); toast('Copied'); }} />
            </View>
          </TVFocusable>
        )}
        ListEmptyComponent={want && !loading ? (
          <AppText role="bodyLarge" style={{color: colors.onSurfaceVariant, textAlign: 'center', marginTop: 32}}>No sources found. Add Stremio add-ons or turn on more torrent sites.</AppText>
        ) : null}
      />
      {busy ? (
        <View accessibilityLiveRegion="polite" style={{position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, backgroundColor: colors.surfaceContainerHigh, borderWidth: 1, borderColor: colors.primary}}>
          <ActivityIndicator color={colors.primary} />
          <AppText role="bodyMedium" style={{color: colors.onSurface, marginLeft: 12, flex: 1}}>{busy}</AppText>
        </View>
      ) : null}
    </View>
  );
};

export default StreamFinder;

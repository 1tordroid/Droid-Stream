/**
 * TV guide grid: channels down, time across in half-hour slots, with a line
 * at the current time. Rows are a virtualised list; each row only draws the
 * programmes near the visible time range, so hundreds of channels and several
 * days of guide stay light. The channel column stays put while the grid
 * scrolls sideways (a native-driven translate of the horizontal offset).
 *
 * Select a programme on now to watch live, a past one to replay it (when the
 * channel has catch-up), or a future one to set a reminder.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Pressable,
  ToastAndroid,
  View,
  useWindowDimensions,
  type HostInstance,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import {TVFocusable} from '../../components/tv';
import Button from '../../components/ui/Button';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {catchupInfo} from '../../lib/livetv/catchup';
import {
  DAY,
  HOUR,
  MINUTE,
  dayLabel,
  floorSlot,
  formatClock,
  guideWindow,
  layoutRow,
  timeSlots,
  type GuideCell,
  type GuideProgramme,
  type GuideWindow,
} from '../../lib/livetv/guide';
import {loadXmltvGuide, programmesFor, type GuideData} from '../../lib/livetv/guideLoader';
import {JIO_CATCHUP_DAYS, JIO_SOURCE_ID, jioChannelId, loadJioChannels} from '../../lib/livetv/jio/channels';
import {jioDayOffset, loadJioProgrammes} from '../../lib/livetv/jio/epg';
import {applyFilters, channelFacets, displayChannelName, filterCounts, type ChannelFilters} from '../../lib/livetv/filters';
import {channelGroups} from '../../lib/livetv/m3u';
import {reminderId, reminderIds, toggleReminder} from '../../lib/livetv/reminders';
import {
  getChannelFilters,
  getEpgOverride,
  getJioServer,
  jioEpgUrl,
  listSources,
  loadPlaylist,
  readCachedPlaylist,
  setChannelFilters,
  setEpgOverride,
} from '../../lib/livetv/store';
import {normalizeChannelName} from '../../lib/livetv/xmltv';
import {isTV} from '../../lib/tv';
import {getNodeHandle, requestTVFocusByHandle} from '../../lib/tv/focus';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {canReplayOn, openChannel, openReplay, type GridChannel} from './play';
import {showProgrammeMenu} from './record';
import ChannelFilterBar, {QualityBadge} from './ChannelFilterBar';
import {isKidsChannelGroup} from '../../lib/profiles/kids';
import {isKidsProfileActive} from '../../lib/profiles/profiles';

const CHANNEL_W = isTV ? 200 : 112;
const ROW_H = isTV ? 72 : 62;
const HEADER_H = 32;
const PX_PER_MS = (isTV ? 6 : 4.4) / MINUTE;
/** How far back the grid goes when no channel has catch-up. */
const NO_CATCHUP_BACK = 2 * HOUR;
const MAX_BACK_DAYS = 7;
const FORWARD = 24 * HOUR;
/** Programmes this far outside the visible time range are drawn too, for smooth scrolling and D-pad moves. */
const RANGE_PAD = 3 * HOUR;

type Colors = ReturnType<typeof useM3Colors>;
type Params = {sourceId: string; group?: string};

const withSource = (list: {id: string}[], sourceId: string) => list.map(channel => ({...channel, sourceId}) as GridChannel);

/** JioTV guide days already fetched, per channel, for this app session. */
const jioRows = new Map<string, {offsets: Set<number>; list: GuideProgramme[]}>();

const visibleRange = (window: GuideWindow, x: number, width: number): GuideWindow => {
  const start = window.start + x / PX_PER_MS;
  const end = start + Math.max(width, 1) / PX_PER_MS;
  return {start: floorSlot(start - RANGE_PAD, HOUR), end: floorSlot(end + RANGE_PAD, HOUR) + HOUR};
};

const Cell = memo(function GuideCellView({
  cell,
  channel,
  colors,
  replay,
  reminder,
  preferred,
  nowRef,
  onPress,
  onLongPress,
  onFocus,
}: {
  cell: GuideCell;
  channel: GridChannel;
  colors: Colors;
  replay: boolean;
  reminder: boolean;
  preferred: boolean;
  nowRef?: (node: HostInstance | null) => void;
  onPress: (channel: GridChannel, cell: GuideCell) => void;
  onLongPress: (channel: GridChannel, cell: GuideCell) => void;
  onFocus: (channel: GridChannel, cell: GuideCell) => void;
}) {
  const p = cell.programme;
  const live = cell.state === 'now';
  const title = p ? p.title : live ? 'On now' : '';
  const label = p
    ? `${p.title}, ${formatClock(p.start)} to ${formatClock(p.stop)}${live ? ', on now' : replay ? ', replay available' : reminder ? ', reminder set' : ''}`
    : live
      ? `${channel.name}, on now`
      : `${channel.name}, no guide information`;
  return (
    <TVFocusable
      ref={nowRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={preferred}
      registerScreenFocus={preferred}
      focusScale={1}
      borderRadius={8}
      onPress={() => onPress(channel, cell)}
      onLongPress={() => onLongPress(channel, cell)}
      onFocus={() => onFocus(channel, cell)}
      style={{
        position: 'absolute',
        left: cell.left + 1,
        top: 2,
        width: Math.max(1, cell.width - 2),
        height: ROW_H - 4,
        borderRadius: 8,
        paddingHorizontal: cell.width > 24 ? 8 : 0,
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: live ? colors.secondaryContainer : colors.surfaceContainer,
        opacity: cell.state === 'past' && !replay ? 0.6 : 1,
      }}>
      {cell.width > 24 ? (
        <>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
            {replay ? <MaterialCommunityIcons name="history" size={14} color={colors.primary} /> : null}
            {reminder ? <MaterialCommunityIcons name="bell-ring-outline" size={14} color={colors.primary} /> : null}
            <AppText role="labelLarge" numberOfLines={1} style={{flex: 1, color: live ? colors.onSecondaryContainer : colors.onSurface}}>
              {title}
            </AppText>
          </View>
          {p && cell.width > 70 ? (
            <AppText role="bodySmall" numberOfLines={1} style={{color: live ? colors.onSecondaryContainer : colors.onSurfaceVariant}}>
              {formatClock(p.start)} – {formatClock(p.stop)}
            </AppText>
          ) : null}
        </>
      ) : null}
    </TVFocusable>
  );
});

const ChannelCell = memo(function ChannelCellView({
  channel,
  colors,
  badge,
  onPress,
}: {
  channel: GridChannel;
  colors: Colors;
  /** Shows a quality badge and the name without "(1080p)". */
  badge: boolean;
  onPress: (channel: GridChannel) => void;
}) {
  const quality = badge ? channelFacets(channel).quality : undefined;
  const [logoFailed, setLogoFailed] = useState(false);
  const content = (
    <>
      <View style={{width: isTV ? 56 : 40, height: isTV ? 40 : 30, alignItems: 'center', justifyContent: 'center'}}>
        {channel.logo && !logoFailed ? (
          <Image source={{uri: channel.logo}} resizeMode="contain" onError={() => setLogoFailed(true)} style={{width: '100%', height: '100%'}} />
        ) : (
          <MaterialCommunityIcons name="television-classic" size={22} color={colors.onSurfaceVariant} />
        )}
        {quality ? <QualityBadge label={quality} /> : null}
      </View>
      <AppText role="bodySmall" numberOfLines={2} style={{flex: 1, color: colors.onSurface, marginLeft: 6}}>
        {badge ? displayChannelName(channel.name) : channel.name}
      </AppText>
    </>
  );
  const style = {flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 6};
  // On TV the D-pad stays in the grid: a programme on now plays the channel.
  return isTV ? (
    <View style={style}>{content}</View>
  ) : (
    <Pressable accessibilityRole="button" accessibilityLabel={`Watch ${channel.name} live`} onPress={() => onPress(channel)} style={style}>
      {content}
    </Pressable>
  );
});

interface RowProps {
  channel: GridChannel;
  index: number;
  guide?: GuideData;
  window: GuideWindow;
  range: GuideWindow;
  now: number;
  scrollX: Animated.Value;
  colors: Colors;
  reminders: Set<string>;
  focusNow: boolean;
  badge: boolean;
  registerNowCell: (node: HostInstance | null) => void;
  onPressCell: (channel: GridChannel, cell: GuideCell) => void;
  onLongPressCell: (channel: GridChannel, cell: GuideCell) => void;
  onFocusCell: (channel: GridChannel, cell: GuideCell) => void;
  onPlayChannel: (channel: GridChannel) => void;
}

const Row = memo(function GuideRow({
  channel,
  index,
  guide,
  window,
  range,
  now,
  scrollX,
  colors,
  reminders,
  focusNow,
  badge,
  registerNowCell,
  onPressCell,
  onLongPressCell,
  onFocusCell,
  onPlayChannel,
}: RowProps) {
  const jioId = jioChannelId(channel.url);
  const [jioList, setJioList] = useState<GuideProgramme[] | undefined>(() => (jioId ? jioRows.get(jioId)?.list : undefined));

  useEffect(() => {
    if (!jioId) return;
    const entry = jioRows.get(jioId) || {offsets: new Set<number>(), list: []};
    jioRows.set(jioId, entry);
    const wanted: number[] = [];
    const first = Math.max(-JIO_CATCHUP_DAYS, jioDayOffset(Math.max(range.start, window.start)));
    const last = Math.min(1, jioDayOffset(Math.min(range.end, window.end) - 1));
    for (let offset = first; offset <= last; offset++) if (!entry.offsets.has(offset)) wanted.push(offset);
    if (!wanted.length) return;
    wanted.forEach(offset => entry.offsets.add(offset));
    let alive = true;
    loadJioProgrammes(jioId, wanted)
      .then(list => {
        entry.list = [...entry.list.filter(p => !list.some(q => q.start === p.start)), ...list].sort((a, b) => a.start - b.start);
        if (alive) setJioList(entry.list);
      })
      .catch(() => wanted.forEach(offset => entry.offsets.delete(offset)));
    return () => {
      alive = false;
    };
  }, [jioId, range.start, range.end, window.start, window.end]);

  const programmes = useMemo(() => (jioId ? jioList : programmesFor(guide, channel, normalizeChannelName)) || [], [jioId, jioList, guide, channel]);
  const cells = useMemo(() => layoutRow(programmes, window, PX_PER_MS, now, range), [programmes, window, now, range]);
  const info = useMemo(() => catchupInfo(channel), [channel]);
  const nowX = (now - window.start) * PX_PER_MS;
  const channelKey = `${channel.sourceId}|${channel.id}`;

  return (
    <View style={{height: ROW_H, width: CHANNEL_W + (window.end - window.start) * PX_PER_MS, borderBottomWidth: 1, borderColor: colors.surfaceContainerHigh}}>
      <View style={{position: 'absolute', left: CHANNEL_W, top: 0, bottom: 0, right: 0}}>
        {cells.map(cell => {
          const preferred = focusNow && index === 0 && cell.state === 'now';
          return (
            <Cell
              key={cell.key}
              cell={cell}
              channel={channel}
              colors={colors}
              replay={!!info && !!cell.programme && cell.state === 'past' && canReplayOn(channel, cell.programme, now)}
              reminder={!!cell.programme && cell.state === 'future' && reminders.has(reminderId(channelKey, cell.programme.start))}
              preferred={preferred}
              nowRef={index === 0 && cell.state === 'now' ? registerNowCell : undefined}
              onPress={onPressCell}
              onLongPress={onLongPressCell}
              onFocus={onFocusCell}
            />
          );
        })}
        <View pointerEvents="none" style={{position: 'absolute', left: nowX - 1, top: 0, bottom: 0, width: 2, backgroundColor: colors.primary}} />
      </View>
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: CHANNEL_W,
          backgroundColor: colors.background,
          borderRightWidth: 1,
          borderColor: colors.surfaceContainerHigh,
          zIndex: 2,
          elevation: 2,
          transform: [{translateX: scrollX}],
        }}>
        <ChannelCell channel={channel} colors={colors} badge={badge} onPress={onPlayChannel} />
      </Animated.View>
    </View>
  );
});

const LiveGuide = ({navigation, route}: {navigation: any; route: {params: Params}}) => {
  const {sourceId, group: groupParam} = route.params;
  const colors = useM3Colors();
  const {width: screenWidth} = useWindowDimensions();
  const isJio = sourceId === JIO_SOURCE_ID;
  const source = useMemo(() => listSources().find(item => item.id === sourceId), [sourceId]);
  const sourceName = isJio ? 'JioTV' : source?.name || 'Live TV';
  // A kids profile keeps only kids, animation and cartoon groups.
  const filterKids = useCallback(
    (list: GridChannel[]) => (isKidsProfileActive() ? list.filter(channel => isKidsChannelGroup(channel.group)) : list),
    [],
  );

  const [allChannels, setAllChannels] = useState<GridChannel[]>(() => {
    const cached = source ? readCachedPlaylist(source) : undefined;
    return cached ? filterKids(withSource(cached.playlist.channels, sourceId)) : [];
  });
  // The same saved filters as the Live TV screen (per source and per profile).
  const [filters, setFilters] = useState<ChannelFilters>(() => {
    const saved = getChannelFilters(sourceId);
    return groupParam ? {...saved, group: groupParam} : saved;
  });
  const [filtersUsed, setFiltersUsed] = useState(false);
  const groups = useMemo(() => channelGroups(allChannels), [allChannels]);
  const group = filters.group && groups.includes(filters.group) ? filters.group : undefined;
  const effective = useMemo<ChannelFilters>(() => ({...filters, group}), [filters, group]);
  const channels = useMemo(() => applyFilters(allChannels, effective), [allChannels, effective]);
  const counts = useMemo(() => filterCounts(allChannels, effective), [allChannels, effective]);
  const updateFilters = useCallback(
    (next: ChannelFilters) => {
      setFiltersUsed(true);
      setFilters(next);
      setChannelFilters(sourceId, next);
    },
    [sourceId],
  );
  const [playlistEpg, setPlaylistEpg] = useState<string | undefined>(() => (source ? readCachedPlaylist(source)?.playlist.epgUrl : undefined));
  const [override, setOverride] = useState(() => getEpgOverride(sourceId) || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(override);
  const [guide, setGuide] = useState<GuideData>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [reminders, setReminders] = useState(() => reminderIds());
  const [selected, setSelected] = useState<{channel: GridChannel; cell: GuideCell}>();
  const [opening, setOpening] = useState(false);

  // ---- Channels ----
  useEffect(() => {
    let alive = true;
    const load = isJio
      ? loadJioChannels().then(list => withSource(list, sourceId))
      : source
        ? loadPlaylist(source).then(result => {
            if (alive) setPlaylistEpg(result.playlist.epgUrl);
            return withSource(result.playlist.channels, sourceId);
          })
        : Promise.reject(new Error('This source is no longer in Live TV.'));
    load
      .then(list => alive && setAllChannels(filterKids(list)))
      .catch(err => alive && setError(err?.message || 'Could not load the channels.'));
    return () => {
      alive = false;
    };
  }, [isJio, source, sourceId, filterKids]);

  // ---- Time ----
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const backMs = useMemo(() => {
    let days = 0;
    for (const channel of allChannels) days = Math.max(days, catchupInfo(channel)?.days || 0);
    return days ? Math.min(days, MAX_BACK_DAYS) * DAY : NO_CATCHUP_BACK;
  }, [allChannels]);
  const window = useMemo(() => guideWindow(Date.now(), backMs, FORWARD), [backMs]);
  const stripWidth = Math.round((window.end - window.start) * PX_PER_MS);

  // ---- XMLTV guide ----
  const jiotv = source?.kind === 'jiotv' ? getJioServer() : undefined;
  const epgUrl = isJio ? undefined : override || playlistEpg || (jiotv ? jioEpgUrl(jiotv) : undefined);
  // Every channel of the source, so changing a filter does not load the guide again.
  const wanted = useMemo(() => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const channel of allChannels) {
      if (channel.tvgId) ids.add(channel.tvgId);
      for (const name of ['tvgName' in channel ? channel.tvgName : undefined, channel.name]) {
        const clean = name ? normalizeChannelName(name) : '';
        if (clean) names.add(clean);
      }
    }
    return {ids: [...ids], names: [...names], key: `${[...ids].join(',')}|${[...names].join(',')}`};
  }, [allChannels]);
  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;

  useEffect(() => {
    if (!epgUrl || !wanted.key || wanted.key === '|') {
      setGuide(undefined);
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    const {ids, names} = wantedRef.current;
    loadXmltvGuide(epgUrl, {ids, names, backMs}, {force: reload > 0})
      .then(result => alive && setGuide(result))
      .catch(err => alive && setError(err?.message || 'Could not load the guide.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [epgUrl, wanted.key, backMs, reload]);

  // ---- Scrolling ----
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const listRef = useRef<FlatList<GridChannel>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollXRef = useRef(0);
  const [viewport, setViewport] = useState({width: 0, height: 0});
  const stripViewport = Math.max(1, (viewport.width || screenWidth) - CHANNEL_W);
  const [range, setRange] = useState<GuideWindow>(() => visibleRange(window, 0, stripViewport));
  const updateRange = useRef((_x: number) => {});
  updateRange.current = (x: number) => {
    const next = visibleRange(window, x, stripViewport);
    setRange(prev => (prev.start === next.start && prev.end === next.end ? prev : next));
  };
  const onScroll = useMemo(
    () =>
      Animated.event([{nativeEvent: {contentOffset: {x: scrollX}}}], {
        useNativeDriver: true,
        listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
          scrollXRef.current = event.nativeEvent.contentOffset.x;
          updateRange.current(scrollXRef.current);
        },
      }),
    [scrollX],
  );

  const scrollToTime = useCallback(
    (time: number, animated = true) => {
      const x = Math.max(0, Math.min(stripWidth - stripViewport, (time - window.start) * PX_PER_MS - stripViewport / 4));
      scrollRef.current?.scrollTo({x, animated});
      scrollXRef.current = x;
      updateRange.current(x);
    },
    [stripWidth, stripViewport, window.start],
  );

  // Open at the current time (again when the window grows for catch-up).
  const placedFor = useRef(0);
  useEffect(() => {
    if (!viewport.width || placedFor.current === window.start) return;
    placedFor.current = window.start;
    const timer = setTimeout(() => scrollToTime(Date.now(), false), 0);
    return () => clearTimeout(timer);
  }, [viewport.width, window.start, scrollToTime]);

  const nowCellHandle = useRef<number | null>(null);
  const registerNowCell = useCallback((node: HostInstance | null) => {
    nowCellHandle.current = getNodeHandle(node);
  }, []);

  const jumpToNow = useCallback(() => {
    listRef.current?.scrollToOffset({offset: 0, animated: true});
    scrollToTime(Date.now());
    if (isTV) setTimeout(() => requestTVFocusByHandle(nowCellHandle.current), 350);
  }, [scrollToTime]);

  // ---- Actions ----
  const play = useCallback(
    (run: () => Promise<void> | void) => {
      if (opening) return;
      const result = run();
      if (!result) return;
      setOpening(true);
      result
        .catch((err: any) => ToastAndroid.show(err?.message || 'Could not open this channel.', ToastAndroid.LONG))
        .finally(() => setOpening(false));
    },
    [opening],
  );

  const playLive = useCallback((channel: GridChannel) => play(() => openChannel(navigation, channel, sourceName)), [play, navigation, sourceName]);

  const onPressCell = useCallback(
    (channel: GridChannel, cell: GuideCell) => {
      setSelected({channel, cell});
      const programme = cell.programme;
      const time = Date.now();
      if (!programme || programme.start <= time) {
        if (programme && programme.stop <= time) {
          if (canReplayOn(channel, programme, time)) play(() => openReplay(navigation, channel, programme, sourceName));
          else ToastAndroid.show('This programme cannot be replayed.', ToastAndroid.SHORT);
          return;
        }
        if (cell.stop > time && cell.start <= time) playLive(channel);
        else if (!programme) ToastAndroid.show('No guide information for this time.', ToastAndroid.SHORT);
        return;
      }
      toggleReminder(`${channel.sourceId}|${channel.id}`, channel.name, programme)
        .then(result => {
          setReminders(reminderIds());
          const messages = {
            set: `Reminder set for ${programme.title}.`,
            removed: 'Reminder removed.',
            denied: 'Allow notifications to get reminders.',
            'too-late': 'This programme starts too soon for a reminder.',
          };
          ToastAndroid.show(messages[result], ToastAndroid.SHORT);
        })
        .catch(() => ToastAndroid.show('Could not set the reminder.', ToastAndroid.SHORT));
    },
    [play, playLive, navigation, sourceName],
  );

  const onLongPressCell = useCallback(
    (channel: GridChannel, cell: GuideCell) => {
      setSelected({channel, cell});
      const programme = cell.programme;
      if (!programme || programme.stop <= Date.now()) return;
      const live = programme.start <= Date.now();
      showProgrammeMenu(channel, programme, [
        live
          ? {label: 'Watch', onPress: () => playLive(channel)}
          : {
              label: reminderIds().has(reminderId(`${channel.sourceId}|${channel.id}`, programme.start)) ? 'Remove reminder' : 'Set reminder',
              onPress: () => onPressCell(channel, cell),
            },
      ]);
    },
    [playLive, onPressCell],
  );

  const onFocusCell = useCallback(
    (channel: GridChannel, cell: GuideCell) => {
      setSelected({channel, cell});
      if (!isTV) return;
      // Keep the focused programme clear of the channel column and the right edge.
      const x = scrollXRef.current;
      const visibleWidth = Math.min(cell.width, stripViewport - 48);
      let target = x;
      if (cell.left < x) target = Math.max(0, cell.left - 24);
      else if (cell.left + visibleWidth > x + stripViewport) target = cell.left + visibleWidth - stripViewport + 24;
      if (target !== x) {
        scrollRef.current?.scrollTo({x: target, animated: true});
        scrollXRef.current = target;
        updateRange.current(target);
      }
    },
    [stripViewport],
  );

  const saveOverride = () => {
    try {
      setEpgOverride(sourceId, draft);
      setOverride(draft.trim());
      setEditing(false);
      setReload(value => value + 1);
    } catch (err: any) {
      ToastAndroid.show(err?.message || 'Could not save this address.', ToastAndroid.SHORT);
    }
  };

  // ---- Rendering ----
  const minuteNow = Math.floor(now / MINUTE) * MINUTE;
  const renderItem = useCallback(
    ({item, index}: {item: GridChannel; index: number}) => (
      <Row
        channel={item}
        index={index}
        guide={guide}
        window={window}
        range={range}
        now={minuteNow}
        scrollX={scrollX}
        colors={colors}
        reminders={reminders}
        focusNow={!editing && !filtersUsed}
        badge={filters.qualityBadge}
        registerNowCell={registerNowCell}
        onPressCell={onPressCell}
        onLongPressCell={onLongPressCell}
        onFocusCell={onFocusCell}
        onPlayChannel={playLive}
      />
    ),
    [guide, window, range, minuteNow, scrollX, colors, reminders, editing, filtersUsed, filters.qualityBadge, registerNowCell, onPressCell, onLongPressCell, onFocusCell, playLive],
  );

  const slots = useMemo(() => timeSlots({start: Math.max(window.start, range.start), end: Math.min(window.end, range.end)}), [window, range]);
  const headerDay = dayLabel(window.start + (scrollXRef.current + stripViewport / 2) / PX_PER_MS, now);

  const status = (() => {
    if (error) return error;
    if (loading) return 'Loading the guide…';
    if (isJio) return '';
    if (!epgUrl) return 'This playlist has no guide address. Add one to see programmes.';
    if (guide && !Object.keys(guide.programmes).length) return 'The guide has no programmes for these channels.';
    return '';
  })();

  const details = selected?.cell.programme;
  const detailState = selected?.cell.state;
  const detailHint = !selected
    ? ''
    : detailState === 'now'
      ? 'On now. Select to watch.'
      : detailState === 'past'
        ? details && canReplayOn(selected.channel, details, Date.now())
          ? 'Select to replay.'
          : 'Ended. Replay is not available.'
        : details
          ? reminders.has(reminderId(`${selected.channel.sourceId}|${selected.channel.id}`, details.start))
            ? 'Reminder set. Select to remove it.'
            : 'Select to set a reminder.'
          : '';

  const onLayout = (event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    setViewport(prev => (prev.width === width && prev.height === height ? prev : {width, height}));
  };

  return (
    <View style={{flex: 1, backgroundColor: colors.background}}>
      <View style={{paddingHorizontal: isTV ? 40 : 12, paddingTop: isTV ? 20 : 8}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
          <View style={{flex: 1}}>
            <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>TV guide</AppText>
            <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>
              {group ? `${sourceName} · ${group}` : sourceName}
            </AppText>
          </View>
          {loading || opening ? <ActivityIndicator color={colors.primary} /> : null}
          <TVFocusable accessibilityRole="button" accessibilityLabel="Jump to now" onPress={jumpToNow} borderRadius={20} style={{padding: 8}}>
            <MaterialCommunityIcons name="clock-outline" size={22} color={colors.onSurfaceVariant} />
          </TVFocusable>
          {!isJio ? (
            <TVFocusable accessibilityRole="button" accessibilityLabel="Guide address" onPress={() => { setDraft(override); setEditing(value => !value); }} borderRadius={20} style={{padding: 8}}>
              <MaterialCommunityIcons name="link-variant" size={22} color={colors.onSurfaceVariant} />
            </TVFocusable>
          ) : null}
          <TVFocusable accessibilityRole="button" accessibilityLabel="Reload the guide" onPress={() => setReload(value => value + 1)} borderRadius={20} style={{padding: 8}}>
            <MaterialCommunityIcons name="refresh" size={22} color={colors.onSurfaceVariant} />
          </TVFocusable>
        </View>
        {editing ? (
          <View style={{paddingVertical: 8}}>
            <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant}}>
              XMLTV guide address (.xml or .xml.gz). Leave it empty to use the playlist's own guide.
            </AppText>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={playlistEpg || 'https://example.com/guide.xml.gz'}
              placeholderTextColor={colors.onSurfaceVariant}
              accessibilityLabel="Guide address"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
              onSubmitEditing={saveOverride}
              style={{backgroundColor: colors.surfaceContainerHigh, color: colors.onSurface, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 16, marginTop: 8}}
            />
            <View style={{flexDirection: 'row', gap: 8, marginTop: 8}}>
              <Button onPress={saveOverride} accessibilityLabel="Save guide address">Save</Button>
              <Button variant="outlined" onPress={() => setEditing(false)} accessibilityLabel="Cancel">Cancel</Button>
            </View>
          </View>
        ) : null}
        {allChannels.length ? (
          <ChannelFilterBar
            filters={effective}
            counts={counts}
            groups={groups}
            shown={channels.length}
            total={allChannels.length}
            onChange={updateFilters}
            onTouch={() => setFiltersUsed(true)}
          />
        ) : null}
        <View style={{minHeight: isTV ? 64 : 56, paddingVertical: 6}}>
          {selected ? (
            <>
              <AppText role="titleMedium" numberOfLines={1} style={{color: colors.onSurface}}>
                {details ? details.title : selected.channel.name}
              </AppText>
              <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>
                {[
                  selected.channel.name,
                  details ? `${dayLabel(details.start, now)} ${formatClock(details.start)} – ${formatClock(details.stop)}` : '',
                  detailHint,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </AppText>
              {details?.desc ? (
                <AppText role="bodySmall" numberOfLines={isTV ? 2 : 1} style={{color: colors.onSurfaceVariant}}>
                  {details.desc}
                </AppText>
              ) : null}
            </>
          ) : (
            <AppText role="bodySmall" style={{color: error ? colors.error : colors.onSurfaceVariant}}>
              {status || (isTV ? 'Pick a programme on now to watch, a past one to replay, a future one for a reminder.' : 'Tap a programme on now to watch, a past one to replay, a future one for a reminder. Long-press to record.')}
            </AppText>
          )}
          {selected && status ? (
            <AppText role="bodySmall" numberOfLines={1} style={{color: error ? colors.error : colors.onSurfaceVariant}}>
              {status}
            </AppText>
          ) : null}
        </View>
      </View>

      <View style={{flex: 1}} onLayout={onLayout}>
        {!channels.length ? (
          <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, paddingHorizontal: isTV ? 40 : 12}}>
            {error || (allChannels.length ? 'No channels match these filters.' : 'Loading channels…')}
          </AppText>
        ) : viewport.height > 0 ? (
          <Animated.ScrollView
            ref={scrollRef as React.Ref<any>}
            horizontal
            onScroll={onScroll}
            scrollEventThrottle={32}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{width: CHANNEL_W + stripWidth}}>
            <View style={{width: CHANNEL_W + stripWidth, height: viewport.height}}>
              <View style={{height: HEADER_H, borderBottomWidth: 1, borderColor: colors.surfaceContainerHigh}}>
                {slots.map(slot => (
                  <View key={slot} style={{position: 'absolute', left: CHANNEL_W + (slot - window.start) * PX_PER_MS, top: 0, bottom: 0, justifyContent: 'center', paddingLeft: 6, borderLeftWidth: 1, borderColor: colors.surfaceContainerHigh}}>
                    <AppText role="labelLarge" style={{color: colors.onSurfaceVariant}}>
                      {formatClock(slot)}
                    </AppText>
                  </View>
                ))}
                <View pointerEvents="none" style={{position: 'absolute', left: CHANNEL_W + (minuteNow - window.start) * PX_PER_MS - 1, top: 0, bottom: 0, width: 2, backgroundColor: colors.primary}} />
                <Animated.View
                  style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: CHANNEL_W, justifyContent: 'center', paddingLeft: 8, backgroundColor: colors.background, zIndex: 2, elevation: 2, transform: [{translateX: scrollX}]}}>
                  <AppText role="labelLarge" style={{color: colors.onSurface}}>{headerDay}</AppText>
                </Animated.View>
              </View>
              <FlatList
                ref={listRef}
                data={channels}
                keyExtractor={item => `${item.sourceId}|${item.id}`}
                renderItem={renderItem}
                getItemLayout={(_, index) => ({length: ROW_H, offset: ROW_H * index, index})}
                initialNumToRender={Math.ceil(viewport.height / ROW_H) + 1}
                maxToRenderPerBatch={8}
                windowSize={isTV ? 5 : 7}
                removeClippedSubviews={!isTV}
                contentContainerStyle={{paddingBottom: 96}}
                style={{flex: 1}}
              />
            </View>
          </Animated.ScrollView>
        ) : null}
      </View>
    </View>
  );
};

export default LiveGuide;

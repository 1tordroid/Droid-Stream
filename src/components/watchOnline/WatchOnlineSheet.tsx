import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Modal, Pressable, ScrollView, ToastAndroid, View} from 'react-native';
import {nextRoute, routeDetail, routeKey, routeLabel, type WatchRoute, type WatchRoutePlan} from '../../lib/watchOnline/routes';
import {buildWatchPlan, runWatchRoute, type WatchProgress} from '../../lib/watchOnline/run';
import {closeWatchOnline, useWatchOnlineStore, type WatchOnlineRequest} from '../../lib/watchOnline/store';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable} from '../tv';
import AppText from '../ui/Text';

type Icon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const iconOf = (route: WatchRoute): Icon => (route.kind === 'debrid' ? 'lightning-bolt' : route.kind === 'pikpak' ? 'cloud-download' : 'play-network');

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : 'That did not work');

/**
 * Plays a magnet or torrent the quickest way it can: cached debrid, then
 * PikPak, then the on-device torrent. Shows the way in use and lets the user
 * pick another.
 */
export const WatchOnlineSheet = ({request, onClose}: {request: WatchOnlineRequest; onClose: () => void}) => {
  const colors = useM3Colors();
  const {result} = request;
  const [plan, setPlan] = useState<WatchRoutePlan>();
  const [active, setActive] = useState<WatchRoute>();
  const [progress, setProgress] = useState<WatchProgress>();
  const [error, setError] = useState<string>();
  const [failed, setFailed] = useState<string[]>([]);
  const controller = useRef<AbortController | undefined>(undefined);
  const closed = useRef(false);

  // The sheet closes before the player opens, so it never sits over it.
  const navigation = useRef({
    navigate: (screen: string, params?: object) => {
      closed.current = true;
      onClose();
      request.navigate(screen, params);
    },
  }).current;

  const start = useCallback(
    async (current: WatchRoutePlan, route: WatchRoute) => {
      controller.current?.abort();
      const own = new AbortController();
      controller.current = own;
      setActive(route);
      setError(undefined);
      setProgress({text: 'Starting…'});
      try {
        await runWatchRoute(route, result, navigation, {signal: own.signal, onProgress: next => !own.signal.aborted && setProgress(next)});
      } catch (cause) {
        if (own.signal.aborted || closed.current) return;
        setFailed(list => [...list, routeKey(route)]);
        const next = nextRoute(current, route);
        if (next) {
          ToastAndroid.show(`${routeLabel(route)}: ${messageOf(cause)}. Trying ${routeLabel(next)}.`, ToastAndroid.LONG);
          start(current, next);
        } else {
          setActive(undefined);
          setProgress(undefined);
          setError(messageOf(cause));
        }
      }
    },
    [navigation, result],
  );

  useEffect(() => {
    buildWatchPlan(result, request.cachedOn)
      .then(next => {
        if (closed.current) return;
        setPlan(next);
        if (next.auto[0]) start(next, next.auto[0]);
        else setError('Nothing here can play this link. Add a debrid key or sign in to PikPak.');
      })
      .catch(cause => !closed.current && setError(messageOf(cause)));
    return () => {
      closed.current = true;
      controller.current?.abort();
    };
    // Runs once for the request this sheet was opened with.
  }, []);

  const cancel = () => {
    closed.current = true;
    controller.current?.abort();
    onClose();
  };

  const routes = plan ? [...plan.auto, ...plan.others] : [];
  return (
    <Modal transparent animationType="slide" visible onRequestClose={cancel}>
      <Pressable accessibilityLabel="Close" onPress={cancel} style={{flex: 1, backgroundColor: '#0008'}} />
      <View style={{maxHeight: '85%', backgroundColor: colors.surfaceContainerLow, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 12}}>
        <View style={{alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: colors.outline, marginBottom: 12}} />
        <AppText role="labelLarge" style={{color: colors.primary, paddingHorizontal: 24}}>Watch online</AppText>
        <AppText role="titleMedium" numberOfLines={2} style={{color: colors.onSurface, paddingHorizontal: 24, marginTop: 2}}>{result.title}</AppText>
        <ScrollView contentContainerStyle={{padding: 12, paddingBottom: 32}}>
          {!plan && !error ? (
            <View style={{flexDirection: 'row', alignItems: 'center', padding: 12}}>
              <ActivityIndicator color={colors.primary} />
              <AppText role="bodyMedium" style={{color: colors.onSurface, marginLeft: 12}}>Checking debrid caches…</AppText>
            </View>
          ) : null}
          {active ? (
            <View style={{backgroundColor: colors.secondaryContainer, borderRadius: 16, padding: 14, marginHorizontal: 4, marginBottom: 8}}>
              <AppText role="labelMedium" style={{color: colors.onSecondaryContainer}}>Using</AppText>
              <AppText role="titleMedium" style={{color: colors.onSecondaryContainer}}>{routeLabel(active)}</AppText>
              <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 6}}>
                <ActivityIndicator color={colors.onSecondaryContainer} size="small" />
                <AppText role="bodyMedium" numberOfLines={2} style={{color: colors.onSecondaryContainer, marginLeft: 8, flex: 1}}>{progress?.text || 'Starting…'}</AppText>
              </View>
              {progress?.fraction !== undefined ? (
                <View style={{height: 4, borderRadius: 2, backgroundColor: colors.surfaceContainerHighest, marginTop: 10, overflow: 'hidden'}}>
                  <View style={{height: 4, width: `${Math.round(Math.max(0, Math.min(1, progress.fraction)) * 100)}%`, backgroundColor: colors.primary}} />
                </View>
              ) : null}
              {active.kind === 'pikpak' ? (
                <AppText role="bodySmall" style={{color: colors.onSecondaryContainer, marginTop: 8}}>
                  If you close this, PikPak keeps downloading. It shows up in Library under PikPak.
                </AppText>
              ) : null}
            </View>
          ) : null}
          {error ? <AppText role="bodyMedium" style={{color: colors.error, paddingHorizontal: 12, paddingVertical: 8}}>{error}</AppText> : null}
          {routes.length ? (
            <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, paddingHorizontal: 12, marginTop: 8, marginBottom: 4}}>Ways to play</AppText>
          ) : null}
          {routes.map((route, index) => {
            const key = routeKey(route);
            const using = active && routeKey(active) === key;
            const badge = using ? 'Using' : failed.includes(key) ? 'Did not work' : index === 0 ? 'Best' : plan?.others.includes(route) ? 'Choose' : '';
            return (
              <TVFocusable key={key} accessibilityRole="button" accessibilityLabel={`Use ${routeLabel(route)}`} accessibilityState={{selected: Boolean(using)}}
                onPress={() => plan && start(plan, route)} borderRadius={14} focusScale={1}
                style={{flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 12, borderRadius: 14}}>
                <MaterialCommunityIcons name={iconOf(route)} size={24} color={using ? colors.primary : colors.onSurfaceVariant} />
                <View style={{marginLeft: 16, flex: 1}}>
                  <AppText role="bodyLarge" style={{color: using ? colors.primary : colors.onSurface}}>{routeLabel(route)}</AppText>
                  <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{routeDetail(route)}</AppText>
                </View>
                {badge ? <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginLeft: 8}}>{badge}</AppText> : null}
              </TVFocusable>
            );
          })}
          <TVFocusable accessibilityRole="button" accessibilityLabel="Cancel" onPress={cancel} hasTVPreferredFocus borderRadius={14} focusScale={1}
            style={{flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 12, borderRadius: 14, marginTop: 4}}>
            <MaterialCommunityIcons name="close" size={24} color={colors.onSurfaceVariant} />
            <AppText role="bodyLarge" style={{color: colors.onSurface, marginLeft: 16}}>{active ? 'Stop' : 'Close'}</AppText>
          </TVFocusable>
        </ScrollView>
      </View>
    </Modal>
  );
};

/** Mounted once at the app root; shows the sheet opened with openWatchOnline. */
const WatchOnlineHost = () => {
  const request = useWatchOnlineStore(state => state.request);
  if (!request) return null;
  return <WatchOnlineSheet key={request.result.id} request={request} onClose={closeWatchOnline} />;
};

export default WatchOnlineHost;

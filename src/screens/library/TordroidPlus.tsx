import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Linking, ToastAndroid, View, type TextInputInstance} from 'react-native';
import {CloudShareButton, QuotaCard} from '../../components/cloud/CloudSourceBar';
import MagnetPreviewCard from '../../components/cloud/MagnetPreviewCard';
import Chip from '../../components/torrentSearch/Chip';
import Button from '../../components/ui/Button';
import KeyboardForm from '../../components/ui/KeyboardForm';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {openExternalApp} from '../../lib/externalApps';
import {looseCloudItem, TORDROID_PLUS_SOURCE_ID} from '../../lib/netlib/cloud';
import {versionKey} from '../../lib/netlib/ids';
import {playNetlibVersion} from '../../lib/netlib/playback';
import {formatQuotaBytes} from '../../lib/pikpak/parse';
import {listSources, readTordroidPlusAccount, saveSource, updateSource} from '../../lib/sources/vault';
import {
  addToTordroidPlus,
  isTordroidPlusSignedIn,
  listTordroidPlusTasks,
  normalizeServer,
  signInToTordroidPlus,
  signOutOfTordroidPlus,
  TORDROID_PLUS_DEFAULT_SERVER,
  TordroidPlusAuthError,
  tordroidPlusMedia,
  tordroidPlusQuota,
  tordroidPlusWebDav,
  type TordroidPlusTask,
  type TordroidPlusVideo,
} from '../../lib/tordroidPlus/client';
import {useM3Colors} from '../../theme/M3PaletteContext';

/** The WebDAV source made from the portal's read-only login; one per install. */
export const TORDROID_PLUS_WEBDAV_ID = 'tordroid-plus-webdav';

const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.LONG);

const stateText = (task: TordroidPlusTask): string =>
  task.state === 'done'
    ? ['Ready', task.size ? formatQuotaBytes(task.size) : ''].filter(Boolean).join(' · ')
    : task.state === 'running'
      ? `${task.progress}% · downloading`
      : task.state === 'failed'
        ? task.message || 'Failed'
        : 'Waiting in the queue';

/** Saves or refreshes the portal's WebDAV login as a library source. Returns its id. */
export const saveTordroidPlusWebDav = async (): Promise<string> => {
  const login = await tordroidPlusWebDav();
  const patch = {kind: 'webdav' as const, name: 'Tordroid Plus WebDAV', server: login.server, username: login.username, secret: login.password, authState: 'ok' as const};
  if (!updateSource(TORDROID_PLUS_WEBDAV_ID, patch)) saveSource({id: TORDROID_PLUS_WEBDAV_ID, ...patch});
  return TORDROID_PLUS_WEBDAV_ID;
};

/** Library > Add source > Tordroid Plus: sign in, family downloads, add magnets, quota and WebDAV. */
const TordroidPlus = ({navigation}: {navigation: any}) => {
  const colors = useM3Colors();
  const saved = readTordroidPlusAccount();
  const [signedIn, setSignedIn] = useState(isTordroidPlusSignedIn());
  const [server, setServer] = useState(saved?.server || TORDROID_PLUS_DEFAULT_SERVER);
  const [email, setEmail] = useState(saved?.email || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<TordroidPlusTask[]>();
  const [error, setError] = useState<string>();
  const [magnet, setMagnet] = useState('');
  const [open, setOpen] = useState<{taskId: number; videos?: TordroidPlusVideo[]}>();
  const passwordRef = useRef<TextInputInstance>(null);

  const onError = useCallback((cause: any, fallback: string) => {
    if (cause instanceof TordroidPlusAuthError) setSignedIn(false);
    toast(cause?.message || fallback);
  }, []);

  const load = useCallback(() => {
    if (!isTordroidPlusSignedIn()) return;
    setError(undefined);
    listTordroidPlusTasks(1, 50)
      .then(page => setTasks(page.tasks))
      .catch(cause => {
        if (cause instanceof TordroidPlusAuthError) setSignedIn(false);
        setError(cause?.message || 'Could not load the downloads');
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return;
      load();
      // A WebDAV source made earlier gets the portal's current login.
      if (listSources().some(source => source.id === TORDROID_PLUS_WEBDAV_ID)) saveTordroidPlusWebDav().catch(() => undefined);
    }, [signedIn, load]),
  );

  // Downloads still running are checked again every 30 seconds.
  const running = tasks?.some(task => task.state === 'running' || task.state === 'waiting');
  useEffect(() => {
    if (!signedIn || !running) return;
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [signedIn, running, load]);

  const signIn = async () => {
    if (busy) return;
    if (!email.trim() || !password) {
      toast('Enter your Tordroid Plus email and password');
      return;
    }
    setBusy(true);
    try {
      await signInToTordroidPlus(server, email, password);
      setPassword('');
      setSignedIn(true);
      toast('Signed in to Tordroid Plus');
    } catch (cause: any) {
      toast(cause?.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    signOutOfTordroidPlus();
    setSignedIn(false);
    setTasks(undefined);
  };

  const add = async () => {
    if (busy) return;
    if (!/^(magnet:\?|ed2k:\/\/)/i.test(magnet.trim())) {
      toast('Paste a magnet link first');
      return;
    }
    setBusy(true);
    try {
      toast(await addToTordroidPlus(magnet));
      setMagnet('');
      load();
    } catch (cause: any) {
      onError(cause, 'Could not add the magnet');
    } finally {
      setBusy(false);
    }
  };

  const playFile = (fileId: string, name: string) =>
    playNetlibVersion(navigation, looseCloudItem(TORDROID_PLUS_SOURCE_ID, fileId, name), versionKey(TORDROID_PLUS_SOURCE_ID, fileId));

  const openInVlc = async (fileId: string, name: string) => {
    try {
      const media = await tordroidPlusMedia(fileId);
      if (media.type === 'folder') throw new Error('Open the download and pick a video.');
      const stream = media.streams[0];
      if (!stream) throw new Error('No link for this file yet');
      await openExternalApp('player', stream.url, 'video/*', undefined, name);
    } catch (cause: any) {
      onError(cause, 'Could not open the other player');
    }
  };

  /** A single video plays at once; a folder lists its videos under the row. */
  const play = async (task: TordroidPlusTask, external = false) => {
    if (!task.fileId) return;
    if (!external && open?.taskId === task.id) {
      setOpen(undefined);
      return;
    }
    try {
      const media = await tordroidPlusMedia(task.fileId);
      if (media.type === 'folder') {
        setOpen({taskId: task.id, videos: media.videos});
        if (!media.videos.length) toast('No videos in this download');
        return;
      }
      if (external) await openInVlc(task.fileId, task.name);
      else await playFile(task.fileId, task.name);
    } catch (cause: any) {
      onError(cause, 'Could not open this download');
    }
  };

  const addWebDav = async () => {
    setBusy(true);
    try {
      const id = await saveTordroidPlusWebDav();
      navigation.navigate('SourceLibrary', {sourceId: id});
    } catch (cause: any) {
      onError(cause, 'Could not get the WebDAV login');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {color: colors.onSurface, minHeight: 48, borderBottomWidth: 1, borderColor: colors.outlineVariant, marginBottom: 12};
  const label = (text: string) => <AppText role="labelMedium" style={{color: colors.onSurfaceVariant}}>{text}</AppText>;

  if (!signedIn) {
    return (
      <KeyboardForm style={{backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 48}}>
        <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Tordroid Plus</AppText>
        <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4, marginBottom: 16}}>
          {saved?.signedOut
            ? 'Your sign-in ended. Sign in again.'
            : 'The family portal for a shared PikPak account. Sign in with your portal email and password. They stay encrypted on this device.'}
        </AppText>
        {label('Server')}
        <TextInput accessibilityLabel="Tordroid Plus server" value={server} onChangeText={setServer} placeholder={TORDROID_PLUS_DEFAULT_SERVER} placeholderTextColor={colors.onSurfaceVariant}
          autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="next" style={inputStyle} />
        {label('Email')}
        <TextInput accessibilityLabel="Tordroid Plus email" value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={colors.onSurfaceVariant}
          autoCapitalize="none" autoCorrect={false} autoComplete="email" importantForAutofill="yes" keyboardType="email-address" returnKeyType="next" submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()} style={inputStyle} />
        {label('Password')}
        <TextInput ref={passwordRef} accessibilityLabel="Tordroid Plus password" value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={colors.onSurfaceVariant}
          secureTextEntry autoComplete="password" importantForAutofill="yes" returnKeyType="go" onSubmitEditing={signIn} style={inputStyle} />
        <Button onPress={signIn} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
        <Button variant="text" onPress={() => Linking.openURL(normalizeServer(server)).catch(() => undefined)} style={{marginTop: 8}}>Open the portal</Button>
      </KeyboardForm>
    );
  }

  const account = readTordroidPlusAccount();
  return (
    <KeyboardForm style={{backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 96}}>
      <View style={{flexDirection: 'row', alignItems: 'center'}}>
        <View style={{flex: 1}}>
          <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Tordroid Plus</AppText>
          <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>{account?.email} · {account?.server.replace(/^https?:\/\//, '')}</AppText>
        </View>
        <Button variant="text" onPress={signOut}>Sign out</Button>
      </View>
      <QuotaCard load={tordroidPlusQuota} />

      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12}}>
        <Chip label="Poster library" icon="view-grid-outline" accessibilityLabel="Open the downloads as a poster library" onPress={() => navigation.navigate('SourceLibrary', {sourceId: TORDROID_PLUS_SOURCE_ID})} />
        <Chip label="Add WebDAV to library" icon="cloud-outline" accessibilityLabel="Add the read-only WebDAV login as a library source" onPress={addWebDav} />
        <Chip label="Refresh" icon="refresh" onPress={load} />
      </View>

      <AppText role="titleMedium" style={{color: colors.onSurface, marginTop: 20}}>Add a magnet</AppText>
      <TextInput accessibilityLabel="Magnet link for Tordroid Plus" value={magnet} onChangeText={setMagnet} placeholder="magnet:?xt=urn:btih:..." placeholderTextColor={colors.onSurfaceVariant}
        autoCapitalize="none" autoCorrect={false} multiline style={inputStyle} />
      <MagnetPreviewCard magnet={magnet} />
      <Button variant="tonal" onPress={add} disabled={busy}>Add to family downloads</Button>

      <AppText role="titleMedium" style={{color: colors.onSurface, marginTop: 24, marginBottom: 4}}>Your downloads</AppText>
      {error ? <AppText role="bodyMedium" style={{color: colors.error}}>{error}</AppText> : null}
      {!tasks && !error ? <ActivityIndicator color={colors.primary} style={{marginTop: 12}} /> : null}
      {tasks && !tasks.length ? <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant}}>Nothing yet. Add a magnet above.</AppText> : null}
      {tasks?.map(task => (
        <View key={task.id} style={{backgroundColor: colors.surfaceContainer, borderRadius: 16, padding: 14, marginTop: 8}}>
          <AppText role="titleSmall" numberOfLines={2} style={{color: colors.onSurface}}>{task.name}</AppText>
          <AppText role="bodySmall" style={{color: task.state === 'failed' ? colors.error : colors.onSurfaceVariant, marginTop: 2}}>{stateText(task)}</AppText>
          {task.state === 'running' ? (
            <View style={{height: 4, borderRadius: 2, backgroundColor: colors.surfaceContainerHighest, marginTop: 8, overflow: 'hidden'}}>
              <View style={{height: 4, width: `${task.progress}%`, backgroundColor: colors.primary}} />
            </View>
          ) : null}
          {task.state === 'done' && task.fileId ? (
            <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10}}>
              <Chip label={open?.taskId === task.id ? 'Hide videos' : 'Play'} icon="play" accessibilityLabel={`Play ${task.name}`} onPress={() => play(task)} />
              <Chip label="VLC" icon="vlc" accessibilityLabel={`Open ${task.name} in another player`} onPress={() => play(task, true)} />
              <CloudShareButton sourceId={TORDROID_PLUS_SOURCE_ID} entry={{path: task.fileId, name: task.name, directory: false}} />
            </View>
          ) : null}
          {open?.taskId === task.id && open.videos?.length
            ? open.videos.map(video => (
                <View key={video.id} style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8}}>
                  <MaterialCommunityIcons name="play-circle-outline" size={22} color={colors.primary} />
                  <AppText role="bodyMedium" numberOfLines={2} style={{color: colors.onSurface, flex: 1}}>{`${video.path}${video.name}`}</AppText>
                  <Chip label="Play" accessibilityLabel={`Play ${video.name}`} onPress={() => playFile(video.id, video.name)} />
                  <Chip label="VLC" accessibilityLabel={`Open ${video.name} in another player`} onPress={() => openInVlc(video.id, video.name)} />
                </View>
              ))
            : null}
        </View>
      ))}
    </KeyboardForm>
  );
};

export default TordroidPlus;

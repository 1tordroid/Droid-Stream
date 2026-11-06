import * as RNFS from '@dr.pogodin/react-native-fs';
import React, {useState} from 'react';
import {Pressable, ToastAndroid, View} from 'react-native';
import {RawTextInput as TextInput} from '../components/ui/Text';
import AppText from '../components/ui/Text';
import {
  addMagnetTask,
  assertMagnet,
  readMagnetTask,
  sessionFromToken,
  signInToPikPak,
  type MagnetTask,
  type PikPakSession,
} from '../lib/pikpak/client';
import {clearPikPakAccount, readPikPakAccount, readPikPakUsername, savePikPakAccount} from '../lib/sources/vault';
import {isPikPakAuthError, withPikPak} from '../lib/pikpak/session';
import {settingsStorage} from '../lib/storage';
import {torrentManager} from '../lib/torrentManager';
import {useM3Colors} from '../theme/M3PaletteContext';

type MagnetRoute = 'pikpak' | 'direct';

const Magnet = ({navigation, onClose, pikpakOnly = false}: {navigation: any; onClose?: () => void; pikpakOnly?: boolean}) => {
  const colors = useM3Colors();
  const saved = readPikPakAccount();
  const [route, setRoute] = useState<MagnetRoute>(pikpakOnly ? 'pikpak' : 'direct');
  const [username, setUsername] = useState(saved?.username || readPikPakUsername());
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [magnet, setMagnet] = useState('');
  const [session, setSession] = useState<PikPakSession | undefined>(
    saved ? {accessToken: saved.accessToken, userId: saved.userId} : undefined,
  );
  const [task, setTask] = useState<MagnetTask>();
  const [wifiOnly, setWifiOnly] = useState(settingsStorage.isDirectTorrentWifiOnly());
  const [keepFile, setKeepFile] = useState(settingsStorage.keepDirectTorrentFile());

  const signIn = async () => {
    try {
      const next = token.trim() ? sessionFromToken(token) : await signInToPikPak(username, password);
      // The refresh token keeps a password sign-in going after the access token expires.
      savePikPakAccount({
        username: username || 'PikPak',
        accessToken: next.accessToken,
        userId: next.userId,
        refreshToken: next.refreshToken,
        expiresAt: next.expiresAt,
      });
      setSession(next);
      setPassword('');
      ToastAndroid.show('This device will use your PikPak account', ToastAndroid.SHORT);
    } catch (error: any) {
      ToastAndroid.show(error?.message || 'Sign-in failed', ToastAndroid.LONG);
    }
  };

  const signOut = () => {
    clearPikPakAccount();
    setSession(undefined);
    setTask(undefined);
  };

  const startDirect = async () => {
    try {
      const link = assertMagnet(magnet);
      if (wifiOnly && !(await torrentManager.isOnWifi())) {
        ToastAndroid.show('Direct torrent is set to Wi-Fi only', ToastAndroid.LONG);
        return;
      }
      settingsStorage.setDirectTorrentWifiOnly(wifiOnly);
      settingsStorage.setKeepDirectTorrentFile(keepFile);
      settingsStorage.setTorrentFullDownload(keepFile);
      const added = await torrentManager.addTorrent(link);
      const files = added.files?.length ? added.files : await torrentManager.getFiles(added.infoHash);
      const video = files.find(file => /\.(mkv|mp4|avi|mov|m4v|webm|ts)$/i.test(file.name)) || files[0];
      if (!video) throw new Error('This magnet has no video file yet');
      await torrentManager.prepareVideoFile(added.infoHash, video.index, false, keepFile);
      const url = await torrentManager.getStreamUrl(added.infoHash, video.index);
      navigation.navigate('Player', {
        linkIndex: 0,
        episodeList: [{title: video.name, link}],
        directUrl: url,
        type: 'torrent',
        primaryTitle: video.name,
        poster: {},
        initialStream: {server: 'Direct', link, type: 'torrent'},
      });
    } catch (error: any) {
      ToastAndroid.show(error?.message || 'Could not start the torrent', ToastAndroid.LONG);
    }
  };

  const submitCloud = async () => {
    if (!session) {
      ToastAndroid.show('Sign in to your PikPak account first, or choose Direct', ToastAndroid.LONG);
      return;
    }
    try {
      setTask(await withPikPak(session.accessToken, accessToken => addMagnetTask({...session, accessToken}, magnet)));
    } catch (error: any) {
      onPikPakError(error, 'Could not add the magnet');
    }
  };

  const refreshTask = async () => {
    if (!session || !task) return;
    try {
      setTask(await withPikPak(session.accessToken, accessToken => readMagnetTask({...session, accessToken}, task)));
    } catch (error: any) {
      onPikPakError(error, 'Could not read the progress');
    }
  };

  // PikPak ended the sign-in: show the form again with the username filled in.
  const onPikPakError = (error: any, fallback: string) => {
    if (isPikPakAuthError(error)) {
      setSession(undefined);
      setUsername(readPikPakUsername());
    }
    ToastAndroid.show(error?.message || fallback, ToastAndroid.LONG);
  };

  const downloadToDevice = async () => {
    if (!task?.playUrl) return;
    const name = (task.name || 'pikpak-video').replace(/[^\w.\-]+/g, '_');
    const dest = `${RNFS.DownloadDirectoryPath || RNFS.DocumentDirectoryPath}/${name}`;
    const {promise} = RNFS.downloadFile({fromUrl: task.playUrl, toFile: dest});
    const result = await promise;
    ToastAndroid.show(result.statusCode === 200 ? `Saved ${name}` : 'Download failed', ToastAndroid.LONG);
  };

  return (
    <View style={{flex: 1, backgroundColor: colors.background, padding: 16}}>
      <Pressable onPress={() => (onClose ? onClose() : navigation.goBack())} style={{marginBottom: 8}}>
        <AppText style={{color: colors.primary}}>Back</AppText>
      </Pressable>
      <AppText role="headlineSmallEmphasized" className="text-m3-on-background">Magnet</AppText>
      {!pikpakOnly ? <View style={{flexDirection: 'row', gap: 16, marginVertical: 12}}>
        <Pressable onPress={() => setRoute('direct')}><AppText style={{color: route === 'direct' ? colors.primary : colors.onSurfaceVariant}}>Direct (on-device)</AppText></Pressable>
        <Pressable onPress={() => setRoute('pikpak')}><AppText style={{color: route === 'pikpak' ? colors.primary : colors.onSurfaceVariant}}>PikPak (cloud)</AppText></Pressable>
      </View> : null}
      <TextInput value={magnet} onChangeText={setMagnet} placeholder="magnet:?xt=urn:btih:..." placeholderTextColor={colors.onSurfaceVariant} autoCapitalize="none" multiline style={{color: colors.onSurface, marginBottom: 12}} />
      {route === 'direct' ? (
        <View>
          <AppText role="bodySmall" className="mb-3 text-m3-on-surface-variant">
            Direct torrenting uses this phone. Other peers can see the device IP. A VPN is recommended. Only stream content you have the rights to. Seeding stays off. Playback starts from a local address as soon as the first pieces arrive.
          </AppText>
          <Pressable onPress={() => setWifiOnly(value => !value)}><AppText style={{color: colors.onSurface}}>Wi-Fi only: {wifiOnly ? 'on' : 'off'}</AppText></Pressable>
          <Pressable onPress={() => setKeepFile(value => !value)} style={{marginVertical: 8}}><AppText style={{color: colors.onSurface}}>Keep file after watching: {keepFile ? 'on' : 'off'}</AppText></Pressable>
          <Pressable onPress={startDirect}><AppText style={{color: colors.primary}}>Start on this device</AppText></Pressable>
        </View>
      ) : (
        <View>
          <AppText role="bodySmall" className="mb-3 text-m3-on-surface-variant">
            PikPak is optional. Each person signs in to their own account. The token stays in encrypted storage on this phone. Only send links for content you have the rights to. Nothing is sent to Tordroid.
          </AppText>
          {session ? (
            <Pressable onPress={signOut}><AppText style={{color: colors.primary}}>Sign out of PikPak</AppText></Pressable>
          ) : (
            <>
              <TextInput value={username} onChangeText={setUsername} placeholder="PikPak username" placeholderTextColor={colors.onSurfaceVariant} autoCapitalize="none" style={{color: colors.onSurface, marginBottom: 8}} />
              <TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={colors.onSurfaceVariant} secureTextEntry style={{color: colors.onSurface, marginBottom: 8}} />
              <TextInput value={token} onChangeText={setToken} placeholder="Or paste an access token" placeholderTextColor={colors.onSurfaceVariant} autoCapitalize="none" style={{color: colors.onSurface, marginBottom: 8}} />
              <Pressable onPress={signIn}><AppText style={{color: colors.primary}}>Sign in</AppText></Pressable>
            </>
          )}
          <Pressable onPress={submitCloud} style={{marginTop: 12}}><AppText style={{color: colors.primary}}>Send to my PikPak</AppText></Pressable>
          {task ? (
            <View style={{marginTop: 16}}>
              <AppText className="text-m3-on-surface">{task.name || 'Download'}</AppText>
              <AppText className="text-m3-on-surface-variant">{task.phase || 'Waiting'} {task.progress ? `${task.progress}%` : ''}</AppText>
              <Pressable onPress={refreshTask} style={{marginTop: 8}}><AppText style={{color: colors.primary}}>Refresh progress</AppText></Pressable>
              {task.playUrl ? (
                <>
                  <Pressable onPress={() => navigation.navigate('Player', {linkIndex: 0, episodeList: [{title: task.name || 'PikPak', link: task.playUrl}], directUrl: task.playUrl, type: 'movie', primaryTitle: task.name || 'PikPak', poster: {}})} style={{marginTop: 8}}>
                    <AppText style={{color: colors.primary}}>Stream</AppText>
                  </Pressable>
                  <Pressable onPress={downloadToDevice} style={{marginTop: 8}}><AppText style={{color: colors.primary}}>Download to device</AppText></Pressable>
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
};

export default Magnet;

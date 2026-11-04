import React, {useState} from 'react';
import {Pressable, TextInput, ToastAndroid, View} from 'react-native';
import AppText from '../components/ui/Text';
import {addMagnetTask, readMagnetTask, sessionFromToken, signInToPikPak, type MagnetTask, type PikPakSession} from '../lib/pikpak/client';
import {useM3Colors} from '../theme/M3PaletteContext';

const Magnet = ({navigation, onClose}: {navigation: any; onClose?: () => void}) => {
  const colors = useM3Colors();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [magnet, setMagnet] = useState('');
  const [session, setSession] = useState<PikPakSession>();
  const [task, setTask] = useState<MagnetTask>();

  const signIn = async () => {
    try {
      const next = token.trim() ? sessionFromToken(token) : await signInToPikPak(username, password);
      setSession(next);
      ToastAndroid.show('Signed in to your PikPak account', ToastAndroid.SHORT);
    } catch (error: any) {
      ToastAndroid.show(error?.message || 'Sign-in failed', ToastAndroid.LONG);
    }
  };

  const submit = async () => {
    if (!session) return;
    try {
      const created = await addMagnetTask(session, magnet);
      setTask(created);
    } catch (error: any) {
      ToastAndroid.show(error?.message || 'Could not add the magnet', ToastAndroid.LONG);
    }
  };

  const refresh = async () => {
    if (!session || !task) return;
    setTask(await readMagnetTask(session, task));
  };

  return (
    <View style={{flex: 1, backgroundColor: colors.background, padding: 16}}>
      <Pressable onPress={() => (onClose ? onClose() : navigation.goBack())} style={{marginBottom: 8}}>
        <AppText style={{color: colors.primary}}>Back</AppText>
      </Pressable>
      <AppText role="headlineSmallEmphasized" className="text-m3-on-background">Magnet</AppText>
      <AppText role="bodySmall" className="my-3 text-m3-on-surface-variant">
        Only send magnet links for content you have the rights to stream. Droid Stream sends the link to your own PikPak account, waits for that account's offline download, then plays the file. Nothing is uploaded to Tordroid.
      </AppText>
      <TextInput value={username} onChangeText={setUsername} placeholder="PikPak username" placeholderTextColor={colors.onSurfaceVariant} autoCapitalize="none" style={{color: colors.onSurface, marginBottom: 8}} />
      <TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={colors.onSurfaceVariant} secureTextEntry style={{color: colors.onSurface, marginBottom: 8}} />
      <TextInput value={token} onChangeText={setToken} placeholder="Or paste an access token" placeholderTextColor={colors.onSurfaceVariant} autoCapitalize="none" style={{color: colors.onSurface, marginBottom: 8}} />
      <Pressable onPress={signIn}><AppText style={{color: colors.primary}}>Sign in</AppText></Pressable>
      <TextInput value={magnet} onChangeText={setMagnet} placeholder="magnet:?xt=urn:btih:..." placeholderTextColor={colors.onSurfaceVariant} autoCapitalize="none" multiline style={{color: colors.onSurface, marginTop: 16}} />
      <Pressable onPress={submit} style={{marginTop: 8}}><AppText style={{color: colors.primary}}>Send to my PikPak</AppText></Pressable>
      {task ? (
        <View style={{marginTop: 16}}>
          <AppText className="text-m3-on-surface">{task.name || 'Download'}</AppText>
          <AppText className="text-m3-on-surface-variant">{task.phase || 'Waiting'} {task.progress ? `${task.progress}%` : ''}</AppText>
          <Pressable onPress={refresh} style={{marginTop: 8}}><AppText style={{color: colors.primary}}>Refresh progress</AppText></Pressable>
          {task.playUrl ? (
            <Pressable
              onPress={() => navigation.navigate('Player', {
                linkIndex: 0,
                episodeList: [{title: task.name || 'PikPak', link: task.playUrl}],
                directUrl: task.playUrl,
                type: 'movie',
                primaryTitle: task.name || 'PikPak',
                poster: {},
              })}
              style={{marginTop: 8}}>
              <AppText style={{color: colors.primary}}>Play</AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

export default Magnet;

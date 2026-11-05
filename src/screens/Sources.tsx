import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useState} from 'react';
import {FlatList, Pressable, ToastAndroid, View} from 'react-native';
import {RawTextInput as TextInput} from '../components/ui/Text';
import AppText from '../components/ui/Text';
import {listEmby, listJellyfin, listPlex, signInEmby, signInJellyfin, signInPlex, type LibraryItem} from '../lib/sources/mediaServers';
import {listSmbShare} from '../lib/sources/smb';
import {deleteSource, listSources, saveSource, type SavedSource, type SourceKind} from '../lib/sources/vault';
import {listWebDav, type RemoteFile} from '../lib/sources/webdav';
import Magnet from './Magnet';
import {useM3Colors} from '../theme/M3PaletteContext';

const KINDS: SourceKind[] = ['webdav', 'smb', 'jellyfin', 'emby', 'plex'];

const Sources = ({navigation, route}: {navigation: any; route?: {params?: {kind?: string; openId?: string}}}) => {
  const colors = useM3Colors();
  const [sources, setSources] = useState(listSources());
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<SavedSource>({
    id: '',
    kind: 'webdav',
    name: '',
    server: '',
    username: '',
    secret: '',
    share: '',
  });
  const [open, setOpen] = useState<SavedSource>();
  const [showMagnet, setShowMagnet] = useState(false);
  const [rows, setRows] = useState<Array<{id: string; title: string; directory: boolean; playUrl?: string}>>([]);
  const [folder, setFolder] = useState('');

  const refresh = () => setSources(listSources());
  useEffect(() => {
    const kind = route?.params?.kind;
    if (kind === 'pikpak') setShowMagnet(true);
    else if (kind && kind !== 'pikpak') {
      setAdding(true);
      setDraft(current => ({...current, kind: kind as SourceKind}));
    }
    const openId = route?.params?.openId;
    if (openId) {
      const source = listSources().find(item => item.id === openId);
      if (source) browse(source);
    }
    // Open the requested source once when the screen is entered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const browse = async (source: SavedSource, nextFolder = '') => {
    setOpen(source);
    setFolder(nextFolder);
    try {
      if (source.kind === 'webdav') {
        const files = await listWebDav(source.server, nextFolder || source.server, source.username, source.secret);
        setRows(files.map((file: RemoteFile) => ({id: file.href, title: file.name, directory: file.directory, playUrl: file.directory ? undefined : file.href})));
      } else if (source.kind === 'smb') {
        const files = await listSmbShare(source.server, source.share || '', nextFolder, source.username, source.secret);
        setRows(files.map(file => ({id: `${nextFolder}/${file.name}`, title: file.name, directory: file.directory})));
      } else if (source.kind === 'plex') {
        const items = await listPlex(source.server, source.secret, nextFolder || '/library/sections');
        setRows(items.map((item: LibraryItem) => ({id: item.id, title: item.title, directory: item.kind === 'folder', playUrl: item.playUrl})));
      } else {
        const list = source.kind === 'emby' ? listEmby : listJellyfin;
        const items = await list(source.server, source.username, source.secret, nextFolder || undefined);
        setRows(items.map(item => ({id: item.id, title: item.title, directory: item.kind === 'folder', playUrl: item.playUrl})));
      }
    } catch (error: any) {
      ToastAndroid.show(error?.message || 'Could not open this source', ToastAndroid.LONG);
    }
  };

  const play = (title: string, url?: string) => {
    if (!url) return;
    navigation.navigate('Player', {
      linkIndex: 0,
      episodeList: [{title, link: url}],
      directUrl: url,
      type: 'movie',
      primaryTitle: title,
      poster: {},
      initialStream: {server: 'Source', link: url, type: 'mkv'},
    });
  };

  return (
    <View style={{flex: 1, backgroundColor: colors.background, padding: 16}}>
      <AppText role="headlineSmallEmphasized" className="mb-2 text-m3-on-background">Sources</AppText>
      <AppText role="bodySmall" className="mb-3 text-m3-on-surface-variant">
        SMB, WebDAV, Jellyfin, Emby, and Plex. Sign-in details stay in encrypted storage on this device.
      </AppText>
      {!open ? (
        <>
              <View style={{flexDirection: 'row', gap: 16, marginBottom: 12}}>
            <Pressable onPress={() => setAdding(true)}>
              <AppText style={{color: colors.primary}}>Add source</AppText>
            </Pressable>
          </View>
          <FlatList
            data={sources}
            keyExtractor={item => item.id}
            renderItem={({item}) => (
              <Pressable onPress={() => browse(item)} onLongPress={() => {deleteSource(item.id); refresh();}} style={{paddingVertical: 12}}>
                <AppText className="text-m3-on-surface">{item.name}</AppText>
                <AppText className="text-m3-on-surface-variant">{item.kind} · {item.server}</AppText>
              </Pressable>
            )}
          />
        </>
      ) : (
        <>
          <Pressable onPress={() => setOpen(undefined)} style={{marginBottom: 8}}>
            <AppText style={{color: colors.primary}}>All sources</AppText>
          </Pressable>
          <FlatList
            data={rows}
            keyExtractor={item => item.id}
            renderItem={({item}) => (
              <Pressable
                onPress={() => item.directory ? browse(open, item.id.startsWith('http') ? item.id : item.id) : play(item.title, item.playUrl)}
                style={{paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8}}>
                <MaterialCommunityIcons name={item.directory ? 'folder' : 'play-circle'} size={22} color={colors.primary} />
                <AppText className="text-m3-on-surface">{item.title}</AppText>
              </Pressable>
            )}
          />
        </>
      )}
      {showMagnet ? <Magnet navigation={navigation} pikpakOnly onClose={() => setShowMagnet(false)} /> : null}
      {!showMagnet && adding ? (
        <View style={{position: 'absolute', left: 16, right: 16, bottom: 16, backgroundColor: colors.surfaceContainerHigh, borderRadius: 20, padding: 16}}>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8}}>
            {KINDS.map(kind => (
              <Pressable key={kind} onPress={() => setDraft({...draft, kind})}>
                <AppText style={{color: draft.kind === kind ? colors.primary : colors.onSurfaceVariant}}>{kind}</AppText>
              </Pressable>
            ))}
          </View>
          {(['name', 'server', 'username', 'secret', 'share'] as const).map(field => (
            <TextInput
              key={field}
              value={draft[field] || ''}
              onChangeText={value => setDraft({...draft, [field]: value})}
              placeholder={field === 'secret' ? 'password or token' : field}
              placeholderTextColor={colors.onSurfaceVariant}
              autoCapitalize="none"
              secureTextEntry={field === 'secret'}
              style={{color: colors.onSurface, borderBottomWidth: 1, borderColor: colors.outlineVariant, marginBottom: 8}}
            />
          ))}
          <Pressable
            onPress={async () => {
              try {
                let username = draft.username;
                let secret = draft.secret;
                if (draft.kind === 'jellyfin') {
                  const session = await signInJellyfin(draft.server, draft.username, draft.secret);
                  username = session.userId;
                  secret = session.token;
                } else if (draft.kind === 'emby') {
                  const session = await signInEmby(draft.server, draft.username, draft.secret);
                  username = session.userId;
                  secret = session.token;
                } else if (draft.kind === 'plex' && draft.username) {
                  secret = await signInPlex(draft.username, draft.secret);
                }
                saveSource({...draft, id: `${Date.now()}`, username, secret});
                setAdding(false);
                refresh();
              } catch (error: any) {
                ToastAndroid.show(error?.message || 'Could not save this source', ToastAndroid.LONG);
              }
            }}>
            <AppText style={{color: colors.primary}}>Save</AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

export default Sources;

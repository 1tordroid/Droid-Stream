import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useRef, useState} from 'react';
import {FlatList, Pressable, ToastAndroid, View, type TextInputInstance} from 'react-native';
import {RawTextInput as TextInput} from '../components/ui/Text';
import AppText from '../components/ui/Text';
import Button from '../components/ui/Button';
import KeyboardForm from '../components/ui/KeyboardForm';
import {listEmby, listJellyfin, listPlex, signInEmby, signInJellyfin, signInPlex, type LibraryItem} from '../lib/sources/mediaServers';
import {listSmbShare} from '../lib/sources/smb';
import {deleteSource, listSources, saveSource, type SavedSource, type SourceKind} from '../lib/sources/vault';
import {listWebDav, type RemoteFile} from '../lib/sources/webdav';
import Magnet from './Magnet';
import {useM3Colors} from '../theme/M3PaletteContext';

const KINDS: SourceKind[] = ['webdav', 'smb', 'jellyfin', 'emby', 'plex'];
const KIND_NAMES: Record<SourceKind, string> = {webdav: 'WebDAV', smb: 'SMB', jellyfin: 'Jellyfin', emby: 'Emby', plex: 'Plex'};

type DraftField = 'name' | 'server' | 'username' | 'secret' | 'share';

/** The fields a source needs, labeled for its kind. SMB alone has a share. */
export const sourceFields = (kind: SourceKind): Array<{key: DraftField; label: string; placeholder: string}> => [
  {key: 'name', label: 'Name', placeholder: `My ${KIND_NAMES[kind]}`},
  {
    key: 'server',
    label: kind === 'smb' ? 'Server' : 'Server address',
    placeholder: kind === 'smb' ? '192.168.1.10' : kind === 'webdav' ? 'https://example.com/remote.php/dav/files/me/' : 'http://192.168.1.10:8096',
  },
  {key: 'username', label: kind === 'plex' ? 'Email or username (empty to use a token)' : 'Username', placeholder: kind === 'plex' ? 'you@example.com' : 'Username'},
  {key: 'secret', label: kind === 'plex' ? 'Password, or a Plex token' : 'Password', placeholder: 'Password'},
  ...(kind === 'smb' ? [{key: 'share' as const, label: 'Share name', placeholder: 'Movies'}] : []),
];

const Sources = ({navigation, route}: {navigation: any; route?: {params?: {kind?: string; openId?: string}}}) => {
  const colors = useM3Colors();
  const [sources, setSources] = useState(listSources());
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
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
  const [, setFolder] = useState('');
  const inputs = useRef<Partial<Record<DraftField, TextInputInstance | null>>>({});

  const refresh = () => setSources(listSources());
  // Opened for one task (Library > PikPak, Library > Add WebDAV...): Back,
  // Cancel and Save return there instead of showing this screen's list.
  const launchedFor = route?.params?.kind;
  const leave = (fallback: () => void) => {
    if (launchedFor && navigation.canGoBack?.()) navigation.goBack();
    else fallback();
  };
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

  const saveDraft = async () => {
    if (saving) return;
    if (!draft.server.trim()) {
      ToastAndroid.show('Enter the server address', ToastAndroid.LONG);
      inputs.current.server?.focus();
      return;
    }
    setSaving(true);
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
      saveSource({
        ...draft,
        id: `${Date.now()}`,
        name: draft.name.trim() || KIND_NAMES[draft.kind],
        server: draft.server.trim(),
        share: draft.kind === 'smb' ? draft.share : '',
        username,
        secret,
      });
      ToastAndroid.show('Source saved', ToastAndroid.SHORT);
      leave(() => {
        setAdding(false);
        refresh();
      });
    } catch (error: any) {
      ToastAndroid.show(error?.message || 'Could not save this source', ToastAndroid.LONG);
    } finally {
      setSaving(false);
    }
  };

  // PikPak sign-in gets the whole screen so its buttons are never hidden.
  if (showMagnet) {
    return <Magnet navigation={navigation} pikpakOnly onClose={() => leave(() => setShowMagnet(false))} />;
  }

  if (adding) {
    const fields = sourceFields(draft.kind);
    return (
      <KeyboardForm style={{backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 48}}>
        <AppText role="headlineSmallEmphasized" className="mb-2 text-m3-on-background">Add source</AppText>
        <AppText role="bodySmall" className="mb-3 text-m3-on-surface-variant">
          Sign-in details stay in encrypted storage on this device.
        </AppText>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16}}>
          {KINDS.map(kind => (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityState={{selected: draft.kind === kind}}
              onPress={() => setDraft(current => ({...current, kind}))}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 18,
                backgroundColor: draft.kind === kind ? colors.primary : colors.surfaceContainerHigh,
              }}>
              <AppText style={{color: draft.kind === kind ? colors.onPrimary : colors.onSurfaceVariant}}>{KIND_NAMES[kind]}</AppText>
            </Pressable>
          ))}
        </View>
        {fields.map((field, index) => {
          const last = index === fields.length - 1;
          return (
            <View key={field.key} style={{marginBottom: 12}}>
              <AppText role="labelMedium" style={{color: colors.onSurfaceVariant}}>{field.label}</AppText>
              <TextInput
                ref={element => {
                  inputs.current[field.key] = element;
                }}
                accessibilityLabel={field.label}
                value={draft[field.key] || ''}
                // Functional update: autofill can change several fields before a re-render.
                onChangeText={value => setDraft(current => ({...current, [field.key]: value}))}
                placeholder={field.placeholder}
                placeholderTextColor={colors.onSurfaceVariant}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={field.key === 'secret'}
                autoComplete={field.key === 'username' ? 'username' : field.key === 'secret' ? 'password' : 'off'}
                keyboardType={field.key === 'server' ? 'url' : 'default'}
                returnKeyType={last ? 'go' : 'next'}
                submitBehavior={last ? 'blurAndSubmit' : 'submit'}
                onSubmitEditing={() => (last ? saveDraft() : inputs.current[fields[index + 1].key]?.focus())}
                style={{color: colors.onSurface, minHeight: 48, borderBottomWidth: 1, borderColor: colors.outlineVariant}}
              />
            </View>
          );
        })}
        <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8}}>
          <Button variant="text" onPress={() => leave(() => setAdding(false))}>Cancel</Button>
          <Button onPress={saveDraft} disabled={saving}>{saving ? 'Signing in…' : 'Save'}</Button>
        </View>
      </KeyboardForm>
    );
  }

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
    </View>
  );
};

export default Sources;

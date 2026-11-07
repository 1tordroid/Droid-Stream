import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useRef, useState} from 'react';
import {BackHandler, FlatList, Pressable, ToastAndroid, View, type TextInputInstance} from 'react-native';
import {TVFocusable} from '../components/tv';
import {RawTextInput as TextInput} from '../components/ui/Text';
import AppText from '../components/ui/Text';
import Button from '../components/ui/Button';
import KeyboardForm from '../components/ui/KeyboardForm';
import {completeSourceForm, emptySourceForm, formFromSource, listSourceRows, playSource, type SourceForm, type SourceRow} from '../lib/sources/accounts';
import {isSourceAuthError, SOURCE_SERVICE_NAMES as KIND_NAMES, sourceSignedOutMessage} from '../lib/sources/authErrors';
import {deleteSource, listSources, saveSource, updateSource, type SavedSource, type SourceKind} from '../lib/sources/vault';
import {showAppDialog} from '../lib/zustand/appDialogStore';
import {isTV} from '../lib/tv/constants';
import Magnet from './Magnet';
import {useM3Colors} from '../theme/M3PaletteContext';

const KINDS: SourceKind[] = ['webdav', 'smb', 'jellyfin', 'emby', 'plex'];

type DraftField = 'name' | 'server' | 'username' | 'secret' | 'share';

/** A screen in another tab to go back to, e.g. Torrents > Debrid and cloud after a PikPak sign-in. */
export interface SourcesReturnTo {
  tab: string;
  screen: string;
}

export interface SourcesParams {
  kind?: string;
  openId?: string;
  returnTo?: SourcesReturnTo;
}

const serverPlaceholder = (kind: SourceKind): string =>
  kind === 'smb'
    ? '192.168.1.10'
    : kind === 'webdav'
      ? 'https://example.com/remote.php/dav/files/me/'
      : kind === 'plex'
        ? 'http://192.168.1.10:32400'
        : 'http://192.168.1.10:8096';

/**
 * The fields a source needs, labeled for its kind. SMB alone has a share.
 * When editing a signed-in source, an empty password keeps its sign-in.
 */
export const sourceFields = (kind: SourceKind, keepsSignIn = false): Array<{key: DraftField; label: string; placeholder: string}> => [
  {key: 'name', label: 'Name', placeholder: `My ${KIND_NAMES[kind]}`},
  {
    key: 'server',
    label: kind === 'smb' ? 'Server' : 'Server address',
    placeholder: serverPlaceholder(kind),
  },
  {key: 'username', label: kind === 'plex' ? 'Email or username (empty to use a token)' : 'Username', placeholder: kind === 'plex' ? 'you@example.com' : 'Username'},
  {
    key: 'secret',
    label: kind === 'plex' ? 'Password, or a Plex token' : 'Password',
    placeholder: keepsSignIn ? 'Leave empty to keep the current sign-in' : 'Password',
  },
  ...(kind === 'smb' ? [{key: 'share' as const, label: 'Share name', placeholder: 'Movies'}] : []),
];

const Sources = ({navigation, route}: {navigation: any; route?: {params?: SourcesParams}}) => {
  const colors = useM3Colors();
  const [sources, setSources] = useState(listSources());
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  // A new source, or with an id: editing a saved one or signing it in again.
  const [draft, setDraft] = useState<SourceForm>(emptySourceForm());
  const [open, setOpen] = useState<SavedSource>();
  const [showMagnet, setShowMagnet] = useState(false);
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [, setFolder] = useState('');
  const inputs = useRef<Partial<Record<DraftField, TextInputInstance | null>>>({});
  // Bumped by Cancel and on unmount, so a sign-in still running cannot save afterwards.
  const saveRun = useRef(0);
  useEffect(
    () => () => {
      saveRun.current += 1;
    },
    [],
  );

  const refresh = () => setSources(listSources());
  // Opened for one task (Library > PikPak, Library > Add WebDAV...): Back,
  // Cancel and Save return there instead of showing this screen's list.
  const launchedFor = route?.params?.kind;
  const returnTo = route?.params?.returnTo;
  // canGoBack() is also true when only the tab navigator can go back, which
  // would jump to another tab. Only a route below this one in the Library
  // stack counts.
  const hasPreviousRoute = () => (navigation.getState?.()?.index ?? 0) > 0;
  const clearLaunchParams = () => {
    const params = route?.params;
    if (params?.kind || params?.openId || params?.returnTo) {
      navigation.setParams?.({kind: undefined, openId: undefined, returnTo: undefined});
    }
  };
  const leave = (fallback: () => void) => {
    if (returnTo) {
      // Opened from another tab: show the list here next time and go back there.
      fallback();
      clearLaunchParams();
      navigation.navigate(returnTo.tab, {screen: returnTo.screen});
    } else if (launchedFor && hasPreviousRoute()) {
      navigation.goBack();
    } else {
      fallback();
      clearLaunchParams();
    }
  };

  // Runs on entry and again when new params reach a screen that stays mounted,
  // e.g. Library left on Sources and PikPak sign-in opened from Torrents.
  useEffect(() => {
    const kind = route?.params?.kind;
    if (kind === 'pikpak') setShowMagnet(true);
    else if (kind) {
      setShowMagnet(false);
      setAdding(true);
      // A saved source's details do not carry over to a new one.
      setDraft(current => (current.id ? emptySourceForm(kind as SourceKind) : {...current, kind: kind as SourceKind}));
    }
    const openId = route?.params?.openId;
    if (openId) {
      const source = listSources().find(item => item.id === openId);
      if (source) browse(source);
    }
    // Only new params open something.
  }, [route?.params?.kind, route?.params?.openId, route?.params?.returnTo]);

  // Android Back from a form opened from another tab returns to that tab.
  useEffect(() => {
    if (!returnTo || !(showMagnet || adding)) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigation.isFocused?.() === false) return false;
      if (showMagnet) leave(() => setShowMagnet(false));
      else cancelDraft();
      return true;
    });
    return () => subscription.remove();
  });

  const addSource = () => {
    // What was typed for a new source stays; a saved source's details do not.
    setDraft(current => (current.id ? emptySourceForm(current.kind) : current));
    setAdding(true);
  };

  /** Edit a saved source, or sign it in again: same id, everything but the password filled in. */
  const openSignIn = (source: SavedSource) => {
    setDraft(formFromSource(source));
    setAdding(true);
  };

  const browse = async (source: SavedSource, nextFolder = '') => {
    setOpen(source);
    setFolder(nextFolder);
    try {
      const next = await listSourceRows(source, nextFolder);
      if (source.authState === 'signedOut') {
        // The saved sign-in works again.
        setOpen(updateSource(source.id, {authState: 'ok'}) || source);
        refresh();
      }
      setRows(next);
    } catch (error: any) {
      if (isSourceAuthError(error)) {
        // The server ended this sign-in. Retrying will not help, so ask for it
        // again; saving keeps the same id, so Library links still open it.
        const signedOut = updateSource(source.id, {authState: 'signedOut'}) || source;
        refresh();
        setOpen(undefined);
        setRows([]);
        openSignIn(signedOut);
        return;
      }
      ToastAndroid.show(error?.message || 'Could not open this source', ToastAndroid.LONG);
    }
  };

  const confirmDelete = (source: SavedSource) =>
    showAppDialog({
      title: `Delete ${source.name}?`,
      message: 'Its saved sign-in is removed from this device. Nothing changes on the server.',
      actions: [
        {label: 'Cancel'},
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: () => {
            deleteSource(source.id);
            refresh();
          },
        },
      ],
    });

  const saveDraft = async () => {
    if (saving) return;
    const server = draft.server.trim();
    if (!server) {
      ToastAndroid.show('Enter the server address', ToastAndroid.LONG);
      inputs.current.server?.focus();
      return;
    }
    const run = ++saveRun.current;
    setSaving(true);
    try {
      // Read the saved source again: browsing may have marked it signed out meanwhile.
      const existing = draft.id ? listSources().find(item => item.id === draft.id) : undefined;
      const signedInAgain = existing?.authState === 'signedOut';
      // The sign-in goes to the trimmed address, the same one that is saved.
      const source = await completeSourceForm({...draft, server}, existing);
      // Cancelled or left while signing in: nothing is saved.
      if (run !== saveRun.current) return;
      saveSource(source);
      setDraft(emptySourceForm());
      ToastAndroid.show(signedInAgain ? 'Signed in again' : 'Source saved', ToastAndroid.SHORT);
      leave(() => {
        setAdding(false);
        refresh();
        // Carry on to the source the sign-in was needed for.
        if (signedInAgain) browse(source);
      });
    } catch (error: any) {
      if (run !== saveRun.current) return;
      // A failed sign-in leaves the saved source as it was.
      ToastAndroid.show(error?.message || 'Could not save this source', ToastAndroid.LONG);
    } finally {
      if (run === saveRun.current) setSaving(false);
    }
  };

  /** Leaves the form without saving, also while a sign-in is still running. */
  const cancelDraft = () => {
    saveRun.current += 1;
    setSaving(false);
    setDraft(emptySourceForm());
    leave(() => setAdding(false));
  };

  // PikPak sign-in gets the whole screen so its buttons are never hidden.
  if (showMagnet) {
    return <Magnet navigation={navigation} pikpakOnly onClose={() => leave(() => setShowMagnet(false))} />;
  }

  if (adding) {
    // Editing or signing in again keeps the source's kind and id.
    const editing = draft.id ? sources.find(item => item.id === draft.id) : undefined;
    const signedOut = editing?.authState === 'signedOut';
    const fields = sourceFields(draft.kind, Boolean(editing) && !signedOut);
    // Signing in again starts at the first detail still missing. Plex can sign
    // in with a pasted token alone, so it starts at the password or token.
    const focusFirst: DraftField | undefined = signedOut ? ((draft.username || draft.kind === 'plex') ? 'secret' : 'username') : undefined;
    // TV: a new source starts on its kind chips; an edit, with no chips, on its first field.
    const tvFirstField: DraftField | undefined = isTV && editing && !focusFirst ? fields[0].key : undefined;
    return (
      <KeyboardForm style={{backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 48}}>
        <AppText role="headlineSmallEmphasized" className="mb-2 text-m3-on-background">
          {!editing ? 'Add source' : signedOut ? `Sign in to ${editing.name} again` : `Edit ${editing.name}`}
        </AppText>
        <AppText role="bodySmall" className="mb-3 text-m3-on-surface-variant">
          {signedOut ? sourceSignedOutMessage(editing) : 'Sign-in details stay in encrypted storage on this device.'}
        </AppText>
        {!editing ? (
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16}}>
            {KINDS.map(kind => (
              <TVFocusable
                key={kind}
                accessibilityRole="button"
                accessibilityLabel={KIND_NAMES[kind]}
                accessibilityState={{selected: draft.kind === kind}}
                hasTVPreferredFocus={isTV && draft.kind === kind}
                borderRadius={18}
                onPress={() => setDraft(current => ({...current, kind}))}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 18,
                  backgroundColor: draft.kind === kind ? colors.primary : colors.surfaceContainerHigh,
                }}>
                <AppText style={{color: draft.kind === kind ? colors.onPrimary : colors.onSurfaceVariant}}>{KIND_NAMES[kind]}</AppText>
              </TVFocusable>
            ))}
          </View>
        ) : null}
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
                autoFocus={field.key === focusFirst || field.key === tvFirstField}
                returnKeyType={last ? 'go' : 'next'}
                // On TV, blurring after Go would leave the D-pad with nothing focused.
                submitBehavior={last && !isTV ? 'blurAndSubmit' : 'submit'}
                onSubmitEditing={() => (last ? saveDraft() : inputs.current[fields[index + 1].key]?.focus())}
                style={{color: colors.onSurface, minHeight: 48, borderBottomWidth: 1, borderColor: colors.outlineVariant}}
              />
            </View>
          );
        })}
        <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8}}>
          <Button variant="text" onPress={cancelDraft}>Cancel</Button>
          <Button onPress={saveDraft} disabled={saving}>{saving ? 'Signing in…' : signedOut ? 'Sign in' : 'Save'}</Button>
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
            <Pressable onPress={addSource}>
              <AppText style={{color: colors.primary}}>Add source</AppText>
            </Pressable>
          </View>
          <FlatList
            data={sources}
            keyExtractor={item => item.id}
            renderItem={({item}) => {
              const signedOut = item.authState === 'signedOut';
              return (
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                  <Pressable onPress={() => browse(item)} onLongPress={() => confirmDelete(item)} style={{flex: 1, paddingVertical: 12}}>
                    <AppText className="text-m3-on-surface">{item.name}</AppText>
                    <AppText className="text-m3-on-surface-variant">
                      {item.kind} · {item.server}{signedOut ? ' · signed out' : ''}
                    </AppText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={signedOut ? `Sign in to ${item.name} again` : `Edit ${item.name}`}
                    onPress={() => openSignIn(item)}
                    style={{paddingVertical: 12, paddingHorizontal: 8}}>
                    <AppText style={{color: colors.primary}}>{signedOut ? 'Sign in' : 'Edit'}</AppText>
                  </Pressable>
                </View>
              );
            }}
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
                onPress={() => item.directory ? browse(open, item.id.startsWith('http') ? item.id : item.id) : playSource(navigation, open, item.title, item.playUrl)}
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

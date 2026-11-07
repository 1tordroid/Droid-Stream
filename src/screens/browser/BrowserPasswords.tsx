import {useFocusEffect, useNavigation} from '@react-navigation/native';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ScrollView, Share, ToastAndroid, View} from 'react-native';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import ScreenSafeArea from '../../components/ui/ScreenSafeArea';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {copyText} from '../../lib/clipboard';
import {authenticate} from '../../lib/browser/native';
import {deleteLogin, loginsToCsv, readLogins, updateLogin, type SavedLogin} from '../../lib/browser/passwords';
import {useIsKidsProfile} from '../../lib/profiles/useProfiles';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {Field, Section} from '../ytdl/components';

const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.SHORT);
const siteOf = (origin: string) => origin.replace(/^https?:\/\//, '').replace(/^www\./, '');

/** Saved browser passwords of this profile. Seeing, changing or exporting them needs the screen lock. */
const BrowserPasswords = () => {
  const colors = useM3Colors();
  const navigation = useNavigation();
  const kids = useIsKidsProfile();
  const [logins, setLogins] = useState<SavedLogin[]>(readLogins);
  const [query, setQuery] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedLogin | null>(null);

  useEffect(() => {
    if (kids) navigation.goBack();
  }, [kids, navigation]);

  useFocusEffect(useCallback(() => setLogins(readLogins()), []));

  const unlock = async (): Promise<boolean> => {
    if (unlocked) return true;
    const result = await authenticate('Saved passwords', 'Confirm it is you to see your passwords');
    if (result === 'ok') {
      setUnlocked(true);
      return true;
    }
    if (result === 'no-lock') toast('Set a screen lock on this phone first');
    return false;
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = logins.slice().sort((left, right) => siteOf(left.origin).localeCompare(siteOf(right.origin)));
    return needle ? list.filter(item => item.origin.toLowerCase().includes(needle) || item.username.toLowerCase().includes(needle)) : list;
  }, [logins, query]);

  if (kids) return null;

  const exportAll = async () => {
    if (!(await unlock())) return;
    showAppDialog({
      title: 'Export passwords?',
      message: 'They are shared as plain text (CSV). Anyone who can open the file can read them. Delete it after importing.',
      actions: [
        {label: 'Cancel'},
        {label: 'Export', variant: 'primary', onPress: () => Share.share({message: loginsToCsv(logins), title: 'Droid Stream passwords'}).catch(() => undefined)},
      ],
    });
  };

  return (
    <ScreenSafeArea style={{backgroundColor: colors.background}}>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8}}>
        <AppText role="titleLarge" style={{color: colors.onBackground, flex: 1}}>Saved passwords</AppText>
        <IconButton icon="export-variant" label="Export passwords" disabled={!logins.length} onPress={exportAll} />
        <IconButton icon="close" label="Close" onPress={() => navigation.goBack()} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding: 16, paddingBottom: 48}}>
        <View style={{backgroundColor: colors.surfaceContainerHigh, borderRadius: 24, paddingHorizontal: 16, marginBottom: 12}}>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search sites and user names" placeholderTextColor={colors.onSurfaceVariant} accessibilityLabel="Search passwords" style={{color: colors.onSurface, minHeight: 48}} />
        </View>
        {!logins.length ? (
          <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant}}>
            No saved passwords. When you sign in to a site in the browser, Droid Stream offers to save the password. They are kept encrypted on this phone, for this profile only, and are not part of backups.
          </AppText>
        ) : null}
        {visible.map(login => (
          <View key={login.id} style={{backgroundColor: colors.surfaceContainerLow, borderRadius: 20, padding: 14, marginBottom: 8}}>
            <AppText role="titleSmall" style={{color: colors.onSurface}}>{siteOf(login.origin)}</AppText>
            <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant}}>{login.username || '(no user name)'}</AppText>
            <AppText role="bodyMedium" style={{color: colors.onSurface, fontFamily: 'monospace', marginTop: 2}} selectable={shown === login.id}>
              {shown === login.id ? login.password : '••••••••'}
            </AppText>
            <View style={{flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4}}>
              <IconButton icon={shown === login.id ? 'eye-off-outline' : 'eye-outline'} label={shown === login.id ? 'Hide password' : 'Show password'} onPress={async () => { if (shown === login.id) setShown(null); else if (await unlock()) setShown(login.id); }} />
              <IconButton icon="content-copy" label="Copy password" onPress={async () => { if (await unlock()) { copyText(login.password); toast('Password copied'); } }} />
              <IconButton icon="pencil-outline" label="Edit" onPress={async () => { if (await unlock()) setEditing(login); }} />
              <IconButton
                icon="delete-outline"
                label="Delete"
                onPress={() =>
                  showAppDialog({
                    title: `Delete the password for ${siteOf(login.origin)}?`,
                    message: login.username,
                    actions: [{label: 'Cancel'}, {label: 'Delete', variant: 'destructive', onPress: () => { deleteLogin(login.id); setLogins(readLogins()); }}],
                  })
                }
              />
            </View>
            {editing?.id === login.id ? (
              <Section title="Edit">
                <Field label="User name" value={editing.username} onChangeText={username => setEditing({...editing, username})} />
                <View style={{height: 8}} />
                <Field label="Password" value={editing.password} onChangeText={password => setEditing({...editing, password})} />
                <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8}}>
                  <Button variant="text" compact onPress={() => setEditing(null)}>Cancel</Button>
                  <Button compact onPress={() => { updateLogin(login.id, {username: editing.username, password: editing.password}); setEditing(null); setLogins(readLogins()); }}>Save</Button>
                </View>
              </Section>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </ScreenSafeArea>
  );
};

export default BrowserPasswords;

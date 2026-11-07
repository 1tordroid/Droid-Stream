import React, {useMemo, useState} from 'react';
import {ScrollView, ToastAndroid, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {SettingsStackParamList} from '../../App';
import PinDialog, {type PinDialogRequest} from '../../components/profiles/PinDialog';
import ProfileAvatar from '../../components/profiles/ProfileAvatar';
import {TVFocusable} from '../../components/tv';
import Button from '../../components/ui/Button';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {deleteProfileData} from '../../lib/profiles/profileData';
import {
  clearPin,
  createProfile,
  getProfile,
  hasPin,
  listProfiles,
  MAX_NAME_LENGTH,
  PROFILE_COLORS,
  PROFILE_EMOJIS,
  removeProfile,
  setPin,
  updateProfile,
  type ProfileDraft,
} from '../../lib/profiles/profiles';
import useProfilesStore, {switchToProfile} from '../../lib/profiles/useProfiles';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import {useM3Colors} from '../../theme/M3PaletteContext';

type Props = NativeStackScreenProps<SettingsStackParamList, 'ProfileEdit'>;

const toast = (text: string) => ToastAndroid.show(text, ToastAndroid.SHORT);

/** Add a profile (no id) or edit one. A locked profile was unlocked on the list. */
const ProfileEdit = ({navigation, route}: Props) => {
  const colors = useM3Colors();
  const refresh = useProfilesStore(state => state.refresh);
  const activeId = useProfilesStore(state => state.activeId);
  const startKids = useProfilesStore(state => state.kids);
  const existing = route.params?.id ? getProfile(route.params.id) : undefined;
  const [draft, setDraft] = useState<ProfileDraft>(() =>
    existing
      ? {name: existing.name, emoji: existing.emoji, color: existing.color, kids: existing.kids}
      : {name: '', emoji: PROFILE_EMOJIS[listProfiles().length % PROFILE_EMOJIS.length], color: PROFILE_COLORS[listProfiles().length % PROFILE_COLORS.length], kids: false},
  );
  // A PIN typed for a new profile, saved with it.
  const [newPin, setNewPin] = useState<string>();
  const [locked, setLocked] = useState(() => (existing ? hasPin(existing.id) : false));
  const [pinRequest, setPinRequest] = useState<PinDialogRequest>();
  const isActive = existing?.id === activeId;
  const canDelete = Boolean(existing) && !isActive && listProfiles().length > 1;
  const pinSet = existing ? locked : Boolean(newPin);

  const kidsHint = useMemo(
    () => (draft.kids
      ? 'Hides 18+ titles, Torrents, Settings, sign-ins and adult Live TV groups. Put a PIN on the other profiles so kids cannot switch to them.'
      : 'Shows everything'),
    [draft.kids],
  );

  const save = () => {
    try {
      if (existing) {
        updateProfile(existing.id, draft);
        refresh();
        // The profile in use changes kids mode only after a restart.
        if (isActive && draft.kids !== startKids) {
          switchToProfile(existing.id).catch(error => console.error('Could not restart:', error));
          return;
        }
      } else {
        const profile = createProfile(draft);
        if (newPin) setPin(profile.id, newPin);
        refresh();
        toast('Profile added');
      }
      navigation.goBack();
    } catch (error: any) {
      toast(error?.message || 'Could not save the profile');
    }
  };

  const askNewPin = () =>
    setPinRequest({
      kind: 'create',
      title: 'Choose a 4-digit PIN',
      onDone: pin => {
        if (!existing) {
          setNewPin(pin);
          return;
        }
        setPin(existing.id, pin);
        setLocked(true);
        refresh();
        toast('PIN saved');
      },
    });

  const removePin = () => {
    if (!existing) {
      setNewPin(undefined);
      return;
    }
    clearPin(existing.id);
    setLocked(false);
    refresh();
    toast('PIN removed');
  };

  const remove = async () => {
    if (!existing) return;
    try {
      removeProfile(existing.id);
      await deleteProfileData(existing.id);
      refresh();
      toast('Profile deleted');
      navigation.goBack();
    } catch (error: any) {
      toast(error?.message || 'Could not delete the profile');
    }
  };

  const confirmDelete = () => {
    if (!existing) return;
    const ask = () =>
      showAppDialog({
        title: `Delete ${existing.name}?`,
        message: 'Its library, Continue watching, positions, recent searches, Live TV favourites and watch-sync sign-ins are deleted. Downloads, providers and settings stay. This cannot be undone.',
        variant: 'error',
        actions: [
          {label: 'Cancel'},
          {label: 'Delete', variant: 'destructive', onPress: () => { remove().catch(() => undefined); }},
        ],
      });
    if (hasPin(existing.id)) {
      setPinRequest({kind: 'verify', profileId: existing.id, title: `Enter the PIN for ${existing.name} to delete it`, onDone: ask});
    } else {
      ask();
    }
  };

  const swatch = (selected: boolean, onPress: () => void, label: string, children: React.ReactNode, background: string) => (
    <TVFocusable
      key={label}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{selected}}
      registerScreenFocus={false}
      borderRadius={24}
      onPress={onPress}
      style={{width: 48, height: 48, borderRadius: 24}}>
      <View
        style={{flex: 1, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: background,
          borderWidth: selected ? 3 : 0, borderColor: colors.primary}}>
        {children}
      </View>
    </TVFocusable>
  );

  return (
    <>
      <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={{padding: 20, paddingBottom: 96}} keyboardShouldPersistTaps="handled">
        <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>
          {existing ? 'Edit profile' : 'Add profile'}
        </AppText>
        <View style={{alignItems: 'center', marginVertical: 20}}>
          <ProfileAvatar emoji={draft.emoji} color={draft.color} size={96} locked={pinSet} kids={draft.kids} />
        </View>

        <AppText role="labelLarge" style={{color: colors.onSurfaceVariant}}>Name</AppText>
        <TextInput
          accessibilityLabel="Profile name"
          value={draft.name}
          maxLength={MAX_NAME_LENGTH}
          onChangeText={name => setDraft(value => ({...value, name}))}
          placeholder="Name"
          placeholderTextColor={colors.outline}
          returnKeyType="done"
          style={{color: colors.onSurface, minHeight: 48, borderBottomWidth: 1, borderColor: colors.outlineVariant, marginBottom: 20, fontSize: 18}}
        />

        <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>Avatar</AppText>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16}}>
          {PROFILE_EMOJIS.map(emoji =>
            swatch(draft.emoji === emoji, () => setDraft(value => ({...value, emoji})), `Avatar ${emoji}`,
              <AppText style={{fontSize: 24, lineHeight: 30}}>{emoji}</AppText>, colors.surfaceContainerHigh),
          )}
        </View>
        <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>Colour</AppText>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20}}>
          {PROFILE_COLORS.map((color, index) =>
            swatch(draft.color === color, () => setDraft(value => ({...value, color})), `Colour ${index + 1}`, null, color),
          )}
        </View>

        <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, marginBottom: 16}}>
          <SettingsSwitchRow
            title="Kids profile"
            description={kidsHint}
            value={draft.kids}
            onValueChange={kids => setDraft(value => ({...value, kids}))}
            divider={false}
          />
        </View>

        <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 16, marginBottom: 24}}>
          <AppText role="titleMedium" style={{color: colors.onSurface}}>PIN</AppText>
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 4, marginBottom: 12}}>
            {pinSet
              ? 'A PIN is needed to open this profile.'
              : 'Add a 4-digit PIN so others cannot open this profile.'}
          </AppText>
          <View style={{flexDirection: 'row', gap: 10, flexWrap: 'wrap'}}>
            <Button variant="tonal" onPress={askNewPin}>{pinSet ? 'Change PIN' : 'Set PIN'}</Button>
            {pinSet ? <Button variant="text" onPress={removePin}>Remove PIN</Button> : null}
          </View>
        </View>

        <View style={{flexDirection: 'row', gap: 10, flexWrap: 'wrap'}}>
          <Button onPress={save} disabled={!draft.name.trim()}>
            {isActive && draft.kids !== startKids ? 'Save and restart' : 'Save'}
          </Button>
          <Button variant="text" onPress={navigation.goBack}>Cancel</Button>
        </View>

        {existing ? (
          <View style={{marginTop: 32}}>
            {canDelete ? (
              <Button variant="destructive" onPress={confirmDelete}>Delete profile</Button>
            ) : (
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
                {isActive ? 'To delete this profile, switch to another one first.' : 'You cannot delete the last profile.'}
              </AppText>
            )}
          </View>
        ) : null}
      </ScrollView>
      <PinDialog request={pinRequest} onClose={() => setPinRequest(undefined)} />
    </>
  );
};

export default ProfileEdit;

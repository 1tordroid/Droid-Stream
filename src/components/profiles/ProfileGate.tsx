import React, {useCallback, useEffect, useState} from 'react';
import {BackHandler, Modal, ScrollView, View} from 'react-native';
import {pinCheckMessage} from '../../lib/profiles/pin';
import {
  pinNeededToSwitch,
  shouldShowPickerOnStart,
  tryProfilePin,
} from '../../lib/profiles/profiles';
import useProfilesStore, {switchToProfile, type ProfileView} from '../../lib/profiles/useProfiles';
import {isTV} from '../../lib/tv';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable} from '../tv';
import Button from '../ui/Button';
import AppText from '../ui/Text';
import PinPad from './PinPad';
import ProfileAvatar from './ProfileAvatar';

type Step = {kind: 'pick'} | {kind: 'pin'; check: ProfileView; target: ProfileView};

/**
 * "Who's watching?": opens at start when needed (several profiles, "Ask on
 * start", or a PIN on the profile in use) and from Home or Settings. Picking
 * another profile restarts the app as that profile.
 */
const ProfileGate = ({onManage}: {onManage: () => void}) => {
  const colors = useM3Colors();
  const open = useProfilesStore(state => state.pickerOpen);
  const required = useProfilesStore(state => state.pickerRequired);
  const profiles = useProfilesStore(state => state.profiles);
  const activeId = useProfilesStore(state => state.activeId);
  const kids = useProfilesStore(state => state.kids);
  const closePicker = useProfilesStore(state => state.closePicker);
  const [step, setStep] = useState<Step>({kind: 'pick'});
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (shouldShowPickerOnStart()) useProfilesStore.getState().openPicker(true);
  }, []);

  useEffect(() => {
    if (open) setStep({kind: 'pick'});
  }, [open]);

  const finish = useCallback((target: ProfileView) => {
    if (target.id === activeId) {
      closePicker();
      return;
    }
    setSwitching(true);
    switchToProfile(target.id).catch(error => {
      console.error('Could not switch profile:', error);
      setSwitching(false);
    });
  }, [activeId, closePicker]);

  const pick = useCallback((profile: ProfileView) => {
    // Picking the profile in use from Home just closes the picker.
    if (profile.id === activeId && !required) {
      closePicker();
      return;
    }
    const needed = pinNeededToSwitch(profile.id);
    const check = needed ? profiles.find(item => item.id === needed) : undefined;
    if (check) setStep({kind: 'pin', check, target: profile});
    else finish(profile);
  }, [activeId, closePicker, finish, profiles, required]);

  const close = useCallback(() => {
    if (step.kind === 'pin') {
      setStep({kind: 'pick'});
      return;
    }
    if (required) BackHandler.exitApp();
    else closePicker();
  }, [closePicker, required, step.kind]);

  if (!open) return null;

  const pinTitle = step.kind === 'pin'
    ? step.check.id === step.target.id ? `Enter the PIN for ${step.check.name}` : `Enter the PIN for ${step.check.name} to leave it`
    : '';

  return (
    <Modal visible animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={{flex: 1, backgroundColor: colors.background, justifyContent: 'center'}}>
        {switching ? (
          <AppText role="titleLarge" style={{color: colors.onBackground, textAlign: 'center'}}>Switching profile…</AppText>
        ) : step.kind === 'pin' ? (
          <View style={{alignItems: 'center', padding: 24}}>
            <ProfileAvatar emoji={step.check.emoji} color={step.check.color} size={64} />
            <View style={{height: 16}} />
            <PinPad
              title={pinTitle}
              onCancel={() => setStep({kind: 'pick'})}
              onComplete={pin => {
                const result = tryProfilePin(step.check.id, pin);
                if (result.ok) {
                  finish(step.target);
                  return undefined;
                }
                return pinCheckMessage(result);
              }}
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{flexGrow: 1, justifyContent: 'center', padding: 24}}>
            <AppText role="headlineMediumEmphasized" style={{color: colors.onBackground, textAlign: 'center', marginBottom: 28}}>
              Who's watching?
            </AppText>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: isTV ? 28 : 20}}>
              {profiles.map((profile, index) => (
                <TVFocusable
                  key={profile.id}
                  testID={`profile-${profile.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${profile.name}${profile.kids ? ', kids' : ''}${profile.locked ? ', locked' : ''}`}
                  hasTVPreferredFocus={profile.id === activeId || (index === 0 && !profiles.some(item => item.id === activeId))}
                  registerScreenFocus={false}
                  borderRadius={20}
                  onPress={() => pick(profile)}
                  style={{borderRadius: 20, padding: 10, width: isTV ? 150 : 120, alignItems: 'center'}}>
                  {({focused}) => (
                    <View style={{alignItems: 'center'}}>
                      <ProfileAvatar emoji={profile.emoji} color={profile.color} size={isTV ? 96 : 80} locked={profile.locked} kids={profile.kids} />
                      <AppText
                        role={focused || profile.id === activeId ? 'titleMediumEmphasized' : 'titleMedium'}
                        numberOfLines={1}
                        style={{color: focused ? colors.primary : colors.onBackground, marginTop: 10}}>
                        {profile.name}
                      </AppText>
                    </View>
                  )}
                </TVFocusable>
              ))}
            </View>
            <View style={{flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 32}}>
              {!kids ? (
                <Button variant="tonal" onPress={() => { closePicker(); onManage(); }} disabled={required && profiles.find(item => item.id === activeId)?.locked}>
                  Manage profiles
                </Button>
              ) : null}
              {!required ? <Button variant="text" onPress={closePicker}>Close</Button> : null}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

export default ProfileGate;

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {ToastAndroid, View} from 'react-native';
import Button from '../components/ui/Button';
import AppText from '../components/ui/Text';
import {TVFocusable} from '../components/tv';
import {pickLocalFolder} from '../lib/localContent/files';
import {listDeviceSources, removeLibrary, saveDeviceSource, setSourceSettings} from '../lib/netlib/cache';
import {scanNetlibSource} from '../lib/netlib/library';
import {isTV} from '../lib/tv/constants';
import {useM3Colors} from '../theme/M3PaletteContext';
import {SourceLibraryView} from './library/SourceLibrary';

/** The device library source: one folder on this phone or TV. */
export const DEVICE_SOURCE_ID = 'device';

/**
 * Videos on this device, as a library source: pick a folder once and its
 * videos stay in a poster grid with Movies, Shows, Other and Folders.
 */
const LocalLibrary = ({navigation}: {navigation: any}) => {
  const colors = useM3Colors();
  const [source, setSource] = useState(() => listDeviceSources().find(item => item.id === DEVICE_SOURCE_ID));

  const pick = async () => {
    try {
      const folder = await pickLocalFolder();
      if (!folder) return;
      const next = {id: DEVICE_SOURCE_ID, kind: 'device' as const, name: folder.name || 'On this device', root: folder.uri};
      if (source && source.root !== folder.uri) {
        // A new folder starts a new library; matches are cached and come back at once.
        removeLibrary(DEVICE_SOURCE_ID);
        setSourceSettings(DEVICE_SOURCE_ID, {root: undefined});
      }
      saveDeviceSource(next);
      setSource(next);
      scanNetlibSource(DEVICE_SOURCE_ID);
    } catch (error: any) {
      ToastAndroid.show(error?.message || 'Could not open that folder', ToastAndroid.LONG);
    }
  };

  if (source) return <SourceLibraryView sourceId={source.id} navigation={navigation} onChangeFolder={pick} />;

  return (
    <View style={{flex: 1, backgroundColor: colors.background, padding: 16}}>
      <TVFocusable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} borderRadius={24} style={{padding: 8, alignSelf: 'flex-start', borderRadius: 24}}>
        <MaterialCommunityIcons name="arrow-left" size={26} color={colors.onBackground} />
      </TVFocusable>
      <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16}}>
        <MaterialCommunityIcons name="folder-play-outline" size={56} color={colors.primary} />
        <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground, marginTop: 12, textAlign: 'center'}}>
          Videos on this device
        </AppText>
        <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 8, textAlign: 'center', maxWidth: 420}}>
          Pick the folder that holds your movies and shows. Droid Stream sorts them into a poster library, finds artwork,
          and remembers where you stopped. Nothing is copied or uploaded.
        </AppText>
        <View style={{marginTop: 20}}>
          <Button onPress={pick} hasTVPreferredFocus={isTV}>Pick a folder</Button>
        </View>
      </View>
    </View>
  );
};

export default LocalLibrary;

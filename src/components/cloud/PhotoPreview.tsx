import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Image, Modal, View} from 'react-native';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable} from '../tv';
import AppText from '../ui/Text';

/** A full-screen picture from a cloud drive. `load` returns the picture's address. */
const PhotoPreview = ({name, load, onClose}: {name: string; load: () => Promise<string>; onClose: () => void}) => {
  const colors = useM3Colors();
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    load()
      .then(next => live && setUrl(next))
      .catch(cause => live && setError(cause?.message || 'Could not open this picture'));
    return () => {
      live = false;
    };
    // Loads once for the picture this preview opened with.
  }, []);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{flex: 1, backgroundColor: '#000'}}>
        <View style={{flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8}}>
          <TVFocusable accessibilityRole="button" accessibilityLabel="Close picture" onPress={onClose} hasTVPreferredFocus borderRadius={24} style={{padding: 10, borderRadius: 24}}>
            <MaterialCommunityIcons name="close" size={26} color="#fff" />
          </TVFocusable>
          <AppText role="titleMedium" numberOfLines={1} style={{color: '#fff', flex: 1}}>{name}</AppText>
        </View>
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
          {url && !error ? (
            <Image source={{uri: url}} resizeMode="contain" accessibilityLabel={name} onError={() => setError('Could not show this picture')} style={{width: '100%', height: '100%'}} />
          ) : error ? (
            <AppText role="bodyLarge" style={{color: colors.error || '#f88', padding: 24}}>{error}</AppText>
          ) : (
            <ActivityIndicator color="#fff" size="large" />
          )}
        </View>
      </View>
    </Modal>
  );
};

export default PhotoPreview;

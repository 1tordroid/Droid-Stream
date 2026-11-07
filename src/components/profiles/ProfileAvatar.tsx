import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {View} from 'react-native';
import AppText from '../ui/Text';

/** Round emoji avatar, with a lock when the profile has a PIN and a badge for kids. */
const ProfileAvatar = ({
  emoji,
  color,
  size = 72,
  locked,
  kids,
}: {
  emoji: string;
  color: string;
  size?: number;
  locked?: boolean;
  kids?: boolean;
}) => {
  const badge = Math.max(18, Math.round(size * 0.3));
  return (
    <View style={{width: size, height: size}}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <AppText style={{fontSize: size * 0.5, lineHeight: size * 0.62}}>{emoji}</AppText>
      </View>
      {locked ? (
        <View
          style={{position: 'absolute', right: -2, bottom: -2, width: badge, height: badge, borderRadius: badge / 2,
            backgroundColor: '#000000cc', alignItems: 'center', justifyContent: 'center'}}>
          <MaterialCommunityIcons name="lock" size={badge * 0.6} color="#ffffff" />
        </View>
      ) : null}
      {kids ? (
        <View
          style={{position: 'absolute', left: -2, bottom: -2, paddingHorizontal: 5, height: badge, borderRadius: badge / 2,
            backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center'}}>
          <AppText role="labelSmall" style={{color: '#000000', fontSize: badge * 0.45}}>KIDS</AppText>
        </View>
      ) : null}
    </View>
  );
};

export default ProfileAvatar;

import React from 'react';
import {View} from 'react-native';
import type {RatingBadge} from '../../lib/ratings/ratings';
import {useM3Colors} from '../../theme/M3PaletteContext';
import AppText from '../ui/Text';

/**
 * Text labels in each source's usual colour. No logos are bundled: the
 * IMDb, Rotten Tomatoes and Metacritic marks need a licence to show.
 */
export const badgeTone = (badge: RatingBadge): {background: string; text: string} => {
  switch (badge.id) {
    case 'imdb':
      return {background: '#F5C518', text: '#000000'};
    case 'tmdb':
      return {background: '#01B4E4', text: '#0D253F'};
    case 'metacritic':
      return badge.percent >= 61
        ? {background: '#66CC33', text: '#000000'}
        : badge.percent >= 40
          ? {background: '#FFCC33', text: '#000000'}
          : {background: '#FF0000', text: '#FFFFFF'};
    default:
      // Rotten Tomatoes: red at 60% and over, green under.
      return badge.percent >= 60 ? {background: '#FA320A', text: '#FFFFFF'} : {background: '#0AC855', text: '#000000'};
  }
};

const RatingBadges = ({badges}: {badges: RatingBadge[]}) => {
  const colors = useM3Colors();
  if (!badges.length) return null;
  return (
    <View accessibilityRole="summary" style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
      {badges.map(badge => {
        const tone = badgeTone(badge);
        return (
          <View
            key={badge.id}
            accessible
            accessibilityLabel={badge.accessibilityLabel}
            style={{
              alignItems: 'center',
              backgroundColor: colors.surfaceContainerHigh,
              borderRadius: 8,
              flexDirection: 'row',
              overflow: 'hidden',
            }}>
            <View style={{backgroundColor: tone.background, justifyContent: 'center', minHeight: 28, paddingHorizontal: 7}}>
              <AppText role="labelMediumEmphasized" numberOfLines={1} style={{color: tone.text}}>
                {badge.label}
              </AppText>
            </View>
            <AppText role="labelLargeEmphasized" numberOfLines={1} style={{color: colors.onSurface, paddingLeft: 7, paddingRight: badge.detail ? 4 : 8}}>
              {badge.value}
            </AppText>
            {badge.detail ? (
              <AppText role="labelSmall" numberOfLines={1} style={{color: colors.onSurfaceVariant, paddingRight: 8}}>
                {badge.detail}
              </AppText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

export default React.memo(RatingBadges);

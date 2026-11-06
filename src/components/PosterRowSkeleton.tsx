import React from 'react';
import {View} from 'react-native';
import {useM3Colors} from '../theme/M3PaletteContext';
import SkeletonLoader from './Skeleton';

/** Placeholder for a row of posters while it loads, so the layout does not jump. */
const PosterRowSkeleton = ({count = 4, width = 124, title = true}: {count?: number; width?: number; title?: boolean}) => {
  const colors = useM3Colors();
  const base = colors.surfaceContainerHigh;
  const highlight = colors.surfaceContainerHighest;
  return (
    <View accessibilityLabel="Loading" style={{marginTop: 24}}>
      {title ? <SkeletonLoader width={160} height={24} marginVertical={0} baseColor={base} highlightColor={highlight} style={{marginHorizontal: 20, marginBottom: 12, borderRadius: 8}} /> : null}
      <View style={{flexDirection: 'row', gap: 12, paddingHorizontal: 20, overflow: 'hidden'}}>
        {Array.from({length: count}, (_, index) => (
          <View key={index}>
            <SkeletonLoader width={width} height={Math.round(width * 1.5)} marginVertical={0} baseColor={base} highlightColor={highlight} style={{borderRadius: 16}} />
            <SkeletonLoader width={width * 0.8} height={14} marginVertical={8} baseColor={base} highlightColor={highlight} style={{borderRadius: 6}} />
          </View>
        ))}
      </View>
    </View>
  );
};

/** Placeholder for list cards, such as stream results. */
export const CardListSkeleton = ({count = 3}: {count?: number}) => {
  const colors = useM3Colors();
  const base = colors.surfaceContainer;
  const highlight = colors.surfaceContainerHigh;
  return (
    <View accessibilityLabel="Loading">
      {Array.from({length: count}, (_, index) => (
        <View key={index} style={{backgroundColor: base, borderRadius: 16, padding: 14, marginTop: 8}}>
          <SkeletonLoader width="85%" height={18} marginVertical={0} baseColor={highlight} highlightColor={colors.surfaceContainerHighest} style={{borderRadius: 6}} />
          <SkeletonLoader width="45%" height={14} marginVertical={10} baseColor={highlight} highlightColor={colors.surfaceContainerHighest} style={{borderRadius: 6}} />
          <SkeletonLoader width="60%" height={36} marginVertical={0} baseColor={highlight} highlightColor={colors.surfaceContainerHighest} style={{borderRadius: 12}} />
        </View>
      ))}
    </View>
  );
};

export default PosterRowSkeleton;

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {memo} from 'react';
import {Image, Pressable, View} from 'react-native';
import {getService, type DebridId} from '../../lib/debrid';
import {qualityOf} from '../../lib/torrentSearch/rank';
import {findEngine} from '../../lib/torrentSearch/search';
import type {TorrentResult} from '../../lib/torrentSearch/types';
import {formatAge, formatBytes} from '../../lib/torrentSearch/util';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable} from '../tv';
import AppText from '../ui/Text';
import Chip from './Chip';

export const engineName = (id: string): string => findEngine(id)?.name || id.replace(/^(custom|torznab):/, '');

const health = (seeders: number): 'good' | 'ok' | 'poor' => (seeders >= 50 ? 'good' : seeders >= 5 ? 'ok' : 'poor');

const ResultRow = ({
  item,
  cached,
  bookmarked,
  onPress,
  onLongPress,
  onBookmark,
}: {
  item: TorrentResult;
  cached?: DebridId[];
  bookmarked?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onBookmark: () => void;
}) => {
  const colors = useM3Colors();
  const quality = qualityOf(item.title);
  const state = health(item.seeders);
  const seedColor = item.webSeeded ? colors.tertiary : state === 'good' ? '#4CAF50' : state === 'ok' ? '#F9A825' : colors.error;
  return (
    <TVFocusable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.seeders} seeders, ${formatBytes(item.sizeBytes)}`}
      onPress={onPress}
      onLongPress={onLongPress}
      borderRadius={16}
      style={{flexDirection: 'row', backgroundColor: colors.surfaceContainer, borderRadius: 16, padding: 12, marginBottom: 8}}>
      {item.poster ? (
        <Image source={{uri: item.poster}} style={{width: 54, height: 80, borderRadius: 8, marginRight: 12, backgroundColor: colors.surfaceContainerHighest}} />
      ) : null}
      <View style={{flex: 1}}>
        <AppText role="titleSmall" numberOfLines={3} style={{color: colors.onSurface}}>{item.title}</AppText>
        <View style={{flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 6, gap: 10}}>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <MaterialCommunityIcons name={item.webSeeded ? 'web' : 'arrow-up-bold'} size={16} color={seedColor} />
            <AppText role="labelLarge" style={{color: seedColor, marginLeft: 2}}>{item.webSeeded ? 'Web seed' : item.seeders.toLocaleString()}</AppText>
          </View>
          {!item.webSeeded ? (
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <MaterialCommunityIcons name="arrow-down-bold" size={16} color={colors.onSurfaceVariant} />
              <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginLeft: 2}}>{item.leechers.toLocaleString()}</AppText>
            </View>
          ) : null}
          <AppText role="labelLarge" style={{color: colors.onSurfaceVariant}}>{formatBytes(item.sizeBytes)}</AppText>
          {item.uploadedAt ? <AppText role="labelLarge" style={{color: colors.onSurfaceVariant}}>{formatAge(item.uploadedAt)}</AppText> : null}
        </View>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8}}>
          {cached?.map(id => <Chip key={id} label={`${getService(id).name} cached`} icon="lightning-bolt" tone="good" />)}
          {quality.resolution ? <Chip label={quality.resolution === '2160p' ? '4K' : quality.resolution} /> : null}
          {quality.lowQuality ? <Chip label="CAM" tone="warn" icon="alert" /> : null}
          {quality.tags.slice(0, 3).map(tag => <Chip key={tag} label={tag} />)}
        </View>
        <AppText role="labelMedium" numberOfLines={1} style={{color: colors.outline, marginTop: 6}}>
          {item.engines.map(engineName).join(' · ')}{item.uploader ? ` · ${item.uploader}` : ''}
        </AppText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={bookmarked ? 'Remove from saved' : 'Save torrent'} onPress={onBookmark} hitSlop={8} style={{paddingLeft: 8, minWidth: 40, alignItems: 'center'}}>
        <MaterialCommunityIcons name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={24} color={bookmarked ? colors.primary : colors.onSurfaceVariant} />
      </Pressable>
    </TVFocusable>
  );
};

export default memo(ResultRow);

import React from 'react';
import {KeyboardAvoidingView, Modal, Platform} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {LocalMetadata, LocalTitle} from '../../lib/localContent/model';
import {setNetlibMatch} from '../../lib/netlib/library';
import type {NetlibItem, NetlibMatch} from '../../lib/netlib/types';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {MetadataPicker} from '../metadata/MetadataPicker';

/** The picker reads a local title; a library title fills the parts it uses. */
export const pickerTitleFor = (item: NetlibItem): LocalTitle => ({
  id: item.id,
  rootUri: '',
  folderUri: '',
  name: item.year ? `${item.title} ${item.year}` : item.title,
  episodes:
    item.kind === 'show'
      ? [
          {uri: 'a', name: 'a', folder: '', season: 1, episode: 1},
          {uri: 'b', name: 'b', folder: '', season: 1, episode: 2},
        ]
      : [{uri: 'a', name: 'a', folder: ''}],
  ...(item.match?.imdbId ? {metadata: {imdbId: item.match.imdbId, type: item.match.type, title: item.match.title}} : {}),
  useMetadataTitles: false,
});

export const matchFromMetadata = (metadata: LocalMetadata): NetlibMatch => {
  const year = Number(String(metadata.year || '').slice(0, 4)) || undefined;
  return {
    type: metadata.type,
    title: metadata.title,
    imdbId: metadata.imdbId,
    ...(year ? {year} : {}),
    ...(metadata.poster ? {poster: metadata.poster} : {}),
    ...(metadata.background ? {background: metadata.background} : {}),
    ...(metadata.description ? {overview: metadata.description} : {}),
    ...(metadata.rating ? {rating: metadata.rating} : {}),
    ...(metadata.genres?.length ? {genres: metadata.genres} : {}),
  };
};

/** Fix match: pick the right movie or series for a library title by search or IMDb id. */
export default function FixMatch({item, onClose}: {item?: NetlibItem; onClose: () => void}) {
  const colors = useM3Colors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={Boolean(item)} animationType="fade" onRequestClose={onClose}>
      {item ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{
            flex: 1,
            backgroundColor: colors.background,
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 16,
            paddingHorizontal: 20,
          }}>
          <MetadataPicker
            title={pickerTitleFor(item)}
            onBack={onClose}
            onChoose={metadata => {
              setNetlibMatch(item.id, matchFromMetadata(metadata));
              onClose();
            }}
          />
        </KeyboardAvoidingView>
      ) : null}
    </Modal>
  );
}

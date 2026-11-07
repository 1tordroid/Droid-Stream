import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Image, ScrollView, View} from 'react-native';
import {previewMagnet} from '../../lib/pikpak/drive';
import {formatQuotaBytes, type MagnetPreview} from '../../lib/pikpak/parse';
import {useM3Colors} from '../../theme/M3PaletteContext';
import Chip from '../torrentSearch/Chip';
import AppText from '../ui/Text';

const MAX_FILES = 60;

/** "Preview files": the files and sizes in a magnet, before it is added anywhere. */
const MagnetPreviewCard = ({magnet}: {magnet: string}) => {
  const colors = useM3Colors();
  const [preview, setPreview] = useState<MagnetPreview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  // A new magnet clears the old preview.
  useEffect(() => {
    setPreview(undefined);
    setError(undefined);
  }, [magnet]);

  const load = () => {
    if (!magnet.trim().startsWith('magnet:')) {
      setError('Paste a magnet link first.');
      return;
    }
    setLoading(true);
    setError(undefined);
    previewMagnet(magnet.trim())
      .then(setPreview)
      .catch(cause => setError(cause?.message || 'Could not look up this magnet'))
      .finally(() => setLoading(false));
  };

  return (
    <View style={{marginVertical: 8}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
        <Chip label={preview ? 'Look up again' : 'Preview files'} icon="file-search-outline" accessibilityLabel="Preview the files in this magnet" onPress={load} />
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
      </View>
      {error ? <AppText role="bodySmall" style={{color: colors.error, marginTop: 6}}>{error}</AppText> : null}
      {preview ? (
        <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 16, padding: 12, marginTop: 8}}>
          <AppText role="titleSmall" numberOfLines={2} style={{color: colors.onSurface}}>{preview.name}</AppText>
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 2}}>
            {[preview.size ? formatQuotaBytes(preview.size) : '', preview.count ? `${preview.count} ${preview.count === 1 ? 'file' : 'files'}` : ''].filter(Boolean).join(' · ') || 'Size not known yet'}
          </AppText>
          {preview.screenshots.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, marginTop: 8}}>
              {preview.screenshots.slice(0, 6).map(url => (
                <Image key={url} source={{uri: url}} accessibilityIgnoresInvertColors style={{width: 128, height: 72, borderRadius: 8, backgroundColor: colors.surfaceContainerHigh}} />
              ))}
            </ScrollView>
          ) : null}
          {preview.files.slice(0, MAX_FILES).map((file, index) => (
            <View key={`${file.path}/${file.name}/${index}`} style={{flexDirection: 'row', paddingVertical: 4, borderTopWidth: index ? 1 : 0, borderColor: colors.outlineVariant, marginTop: index ? 0 : 8}}>
              <AppText role="bodySmall" numberOfLines={2} style={{color: colors.onSurface, flex: 1}}>{file.path ? `${file.path}/${file.name}` : file.name}</AppText>
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginLeft: 8}}>{formatQuotaBytes(file.size)}</AppText>
            </View>
          ))}
          {preview.files.length > MAX_FILES ? (
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 4}}>And {preview.files.length - MAX_FILES} more</AppText>
          ) : null}
          {!preview.files.length ? (
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 6}}>Only the totals are known. Sign in to PikPak to see each file.</AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

export default MagnetPreviewCard;

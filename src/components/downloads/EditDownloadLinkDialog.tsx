import React, {useState} from 'react';
import {ScrollView, ToastAndroid, View, useWindowDimensions} from 'react-native';
import Button from '../ui/Button';
import MaterialDialogSurface from '../ui/MaterialDialogSurface';
import AppText, {RawTextInput as TextInput} from '../ui/Text';
import {editDownloadLink, editStartsOver} from '../../lib/downloadEngine/editLink';
import {readEditableHeaders} from '../../lib/downloadEngine/linkIdentity';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import type {DownloadItem} from '../../lib/zustand/downloadsStore';
import {useM3Colors} from '../../theme/M3PaletteContext';

const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.SHORT);

/** New address and request headers for a paused or failed download. */
const EditDownloadLinkDialog = ({item, onClose}: {item: DownloadItem; onClose: () => void}) => {
  const colors = useM3Colors();
  const {height} = useWindowDimensions();
  const current = readEditableHeaders(item.headers);
  const [url, setUrl] = useState(item.url);
  const [cookie, setCookie] = useState(current.cookie);
  const [referer, setReferer] = useState(current.referer);
  const [userAgent, setUserAgent] = useState(current.userAgent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputStyle = {
    backgroundColor: colors.surfaceContainerHigh,
    color: colors.onSurface,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 15,
    marginTop: 6,
    marginBottom: 10,
  };
  const field = (label: string, value: string, onChange: (text: string) => void, placeholder?: string) => (
    <View key={label}>
      <AppText role="labelLarge" style={{color: colors.onSurfaceVariant}}>{label}</AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.onSurfaceVariant}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        style={inputStyle}
      />
    </View>
  );

  const save = async () => {
    setBusy(true);
    setError('');
    const edit = {url, headers: {cookie, referer, userAgent}};
    try {
      const result = await editDownloadLink(item.id, edit);
      if (result.status === 'invalid') {
        setError(result.message);
        return;
      }
      if (result.status === 'mismatch') {
        onClose();
        showAppDialog({
          title: 'Start over?',
          message: `${result.message} The saved part cannot be used with this link.`,
          variant: 'warning',
          actions: [
            {label: 'Keep old link'},
            {
              label: 'Start over',
              variant: 'destructive',
              onPress: () => {
                editDownloadLink(item.id, edit, {restart: true})
                  .then(() => toast('Starting over with the new link'))
                  .catch(failure => toast(failure instanceof Error ? failure.message : String(failure)));
              },
            },
          ],
        });
        return;
      }
      onClose();
      toast(editStartsOver(item) || item.downloadedBytes === 0 ? 'Link changed' : 'Link changed. Continuing where it stopped.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MaterialDialogSurface visible onDismiss={onClose} style={{maxHeight: Math.max(240, height - 48)}}>
      <ScrollView style={{flexShrink: 1}} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <AppText role="titleLarge" style={{color: colors.onSurface, marginBottom: 4}}>Edit link</AppText>
        <AppText role="bodySmall" numberOfLines={2} style={{color: colors.onSurfaceVariant, marginBottom: 12}}>
          {editStartsOver(item)
            ? 'A new link for this stream starts it over.'
            : 'The saved part is kept if the new link is the same file.'}
        </AppText>
        {field('Link', url, setUrl, 'https://')}
        {item.sourceType === 'ftp' ? null : (
          <>
            {field('Cookie', cookie, setCookie, 'name=value; other=value')}
            {field('Referer', referer, setReferer, 'https://site.example/')}
            {field('User-Agent', userAgent, setUserAgent, 'Leave empty for the default')}
          </>
        )}
        {error ? <AppText role="bodySmall" style={{color: colors.error, marginBottom: 8}}>{error}</AppText> : null}
        <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4}}>
          <Button variant="text" onPress={onClose} accessibilityLabel="Cancel">Cancel</Button>
          <Button onPress={save} disabled={busy} accessibilityLabel="Save link">{busy ? 'Checking…' : 'Save'}</Button>
        </View>
      </ScrollView>
    </MaterialDialogSurface>
  );
};

export default EditDownloadLinkDialog;

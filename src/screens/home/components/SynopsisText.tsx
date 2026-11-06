import React from 'react';
import {View} from 'react-native';
import AppText from '../../../components/ui/Text';
import {TVFocusable} from '../../../components/tv';
import {isTV} from '../../../lib/tv';
import {useM3Colors} from '../../../theme/M3PaletteContext';

export const SYNOPSIS_PREVIEW_LENGTH = 240;
export const isSynopsisExpandable = (synopsis: string): boolean =>
  synopsis.length > SYNOPSIS_PREVIEW_LENGTH;

export default function SynopsisText({synopsis, expanded, onToggle, inlineToggle = true}: {
  synopsis: string;
  expanded: boolean;
  onToggle: () => void;
  /** False when the parent shows the toggle elsewhere, such as the heading row. */
  inlineToggle?: boolean;
}) {
  const colors = useM3Colors();
  const truncatable = isSynopsisExpandable(synopsis);
  const expandable = truncatable && inlineToggle;
  const text = truncatable && !expanded
    ? `${synopsis.slice(0, SYNOPSIS_PREVIEW_LENGTH).trimEnd()}...`
    : synopsis;
  const content = (
    <AppText role="bodyLarge" style={{color: colors.onSurfaceVariant, lineHeight: 24}}>
      {text}
      {expandable && (
        <AppText
          role="bodyLarge"
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show less synopsis' : 'Read more synopsis'}
          accessibilityState={{expanded}}
          onPress={isTV ? undefined : onToggle}
          style={{color: colors.primary, fontWeight: '700', lineHeight: 24}}>
          {expanded ? ' Show less' : ' Read more'}
        </AppText>
      )}
    </AppText>
  );

  // Native text lays out the link with the final line, including wrapping and
  // font scaling. Never hide it while waiting for measurement callbacks.
  return isTV && expandable ? (
    <TVFocusable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Show less synopsis' : 'Read more synopsis'}
      accessibilityState={{expanded}}
      style={{marginTop: 10}}>
      {content}
    </TVFocusable>
  ) : <View style={{marginTop: 10}}>{content}</View>;
}

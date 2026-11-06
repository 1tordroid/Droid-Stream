import {AntDesign} from '@expo/vector-icons';
import React, {useState} from 'react';
import {Image, Linking, Pressable, View, type HostInstance} from 'react-native';
import {getNodeHandle} from '../../../lib/tv/focus';
import AppText from '../../../components/ui/Text';
import {socialLinks} from '../../../lib/constants';
import {isTV} from '../../../lib/tv';
import {useTVFocusBorderColor} from '../../../lib/tv/useTVFocusBorderColor';
import {useM3Colors} from '../../../theme/M3PaletteContext';

const LinkCard = ({
  label,
  accessibilityLabel,
  onPress,
  children,
  borderColor,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  children: React.ReactNode;
  borderColor?: string;
}) => {
  const colors = useM3Colors();
  const focusBorderColor = useTVFocusBorderColor(colors.primary);
  const [focused, setFocused] = useState(false);
  const ref = React.useRef<HostInstance>(null);
  const [handle, setHandle] = useState<number | null>(null);

  return (
    <Pressable
      ref={ref as any}
      onLayout={() => setHandle(getNodeHandle(ref.current))}
      nextFocusDown={isTV ? handle ?? undefined : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      focusable={isTV ? true : undefined}
      isTVSelectable={isTV ? true : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={({pressed}) => ({
        flex: 1,
        borderColor: isTV && focused ? focusBorderColor : borderColor || colors.outlineVariant,
        borderWidth: isTV && focused ? 2 : 1,
        borderRadius: 18,
        backgroundColor: colors.surfaceContainerHigh,
        transform: [{scale: pressed ? 0.98 : 1}],
      })}>
      <View className="items-center justify-center px-2 py-3">
        {children}
        <AppText role="labelLarge" className="mt-2 text-center text-m3-on-surface" numberOfLines={1}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
};

/** GitHub and tordroid.com, side by side, as on the approved Settings mockup. */
const BrandLinkButtons = () => {
  const colors = useM3Colors();
  return (
    <View className="flex-row gap-3 px-4 py-3">
      <LinkCard
        label="GitHub"
        accessibilityLabel="Droid Stream on GitHub"
        onPress={() => Linking.openURL(socialLinks.github)}>
        <AntDesign name="github" size={36} color={colors.onSurface} />
      </LinkCard>
      <LinkCard
        label="tordroid.com"
        accessibilityLabel="Visit tordroid.com"
        onPress={() => Linking.openURL(socialLinks.website)}>
        <Image
          source={require('../../../../assets/brand/website-icon.png')}
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          style={{height: 36, width: 36}}
        />
      </LinkCard>
    </View>
  );
};

export default BrandLinkButtons;

import {Feather} from '@expo/vector-icons';
import React, {useState} from 'react';
import {Pressable, View, type HostInstance} from 'react-native';
import {RawText as Text} from '../../../components/ui/Text';
import {isTV} from '../../../lib/tv';

/** "Skip intro" style pill shown over the video. */
const SkipButton = ({
  label,
  focusColor,
  focusable,
  onPress,
  buttonRef,
}: {
  label: string;
  focusColor: string;
  focusable: boolean;
  onPress: () => void;
  /** For moving TV focus to the button. */
  buttonRef?: React.Ref<HostInstance>;
}) => {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      ref={buttonRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      focusable={focusable}
      isTVSelectable={focusable}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          backgroundColor:
            !isTV && focused ? focusColor : 'rgba(20, 20, 20, 0.55)',
          borderColor: focused ? '#FFFFFF' : 'rgba(255, 255, 255, 0.28)',
          borderWidth: focused ? 2 : 1,
          borderRadius: 24,
          paddingVertical: 8,
          paddingHorizontal: 16,
          gap: 6,
          transform: [{scale: isTV ? 1 : focused ? 1.08 : pressed ? 0.95 : 1}],
        }}>
        <Text
          numberOfLines={1}
          style={{
            color: 'rgba(255, 255, 255, 0.95)',
            fontWeight: '700',
            fontSize: 13,
            letterSpacing: 0.2,
          }}>
          {label}
        </Text>
        <Feather
          name="chevrons-right"
          size={18}
          color="rgba(255, 255, 255, 0.95)"
        />
      </View>
    </Pressable>
  );
};

export default SkipButton;

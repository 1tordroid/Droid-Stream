import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useState} from 'react';
import {Image, Pressable, Text, TouchableOpacity, View} from 'react-native';
import type {EpisodeLink} from '../../../lib/providers/types';
import {isTV} from '../../../lib/tv';
import {useTVFocusBorderColor} from '../../../lib/tv/useTVFocusBorderColor';

/** One episode in the player's episode sidebar. */

type SidebarEpisodeRowProps = {
  episode: EpisodeLink;
  index: number;
  title: string;
  description?: string;
  imageUri?: string;
  isActive: boolean;
  isFocusable: boolean;
  primaryColor: string;
  onSelect: () => void;
};

const SidebarEpisodeRow = React.memo<SidebarEpisodeRowProps>(
  ({
    index,
    title,
    description,
    imageUri,
    isActive,
    isFocusable,
    primaryColor,
    onSelect,
  }) => {
    const [imageFailed, setImageFailed] = useState(false);
    const [tvFocused, setTvFocused] = useState(false);
    const focusBorderColor = useTVFocusBorderColor(primaryColor);

    useEffect(() => {
      setImageFailed(false);
    }, [imageUri]);

    const content = (
      <>
        {/* Thumbnail */}
        <View
          style={{
            width: 80,
            height: 50,
            borderRadius: 6,
            overflow: 'hidden',
            backgroundColor: '#1C1C1E',
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: 10,
            position: 'relative',
          }}>
          {imageUri && !imageFailed ? (
            <Image
              source={{uri: imageUri}}
              style={{width: '100%', height: '100%'}}
              resizeMode="cover"
              resizeMethod="resize"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <View style={{alignItems: 'center', justifyContent: 'center'}}>
              <MaterialCommunityIcons
                name="movie-outline"
                size={20}
                color="rgba(255,255,255,0.4)"
              />
              <Text
                style={{
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: 10,
                  fontWeight: '600',
                  marginTop: 2,
                }}>
                EP {index + 1}
              </Text>
            </View>
          )}
          {isActive && (
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.45)',
                justifyContent: 'center',
                alignItems: 'center',
              }}>
              <MaterialCommunityIcons
                name="play-circle"
                size={24}
                color={primaryColor}
              />
            </View>
          )}
        </View>
        <View style={{flex: 1, justifyContent: 'center'}}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 13,
              fontWeight: isActive ? '700' : '600',
              color: isActive ? primaryColor : '#FFFFFF',
              marginBottom: description ? 3 : 0,
            }}>
            {title}
          </Text>
          {Boolean(description) && (
            <Text
              numberOfLines={2}
              style={{
                fontSize: 11,
                color: 'rgba(255, 255, 255, 0.55)',
                lineHeight: 14,
              }}>
              {description}
            </Text>
          )}
        </View>
      </>
    );

    if (!isTV) {
      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onSelect}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            padding: 8,
            marginVertical: 4,
            borderRadius: 8,
            backgroundColor: isActive
              ? 'rgba(255, 255, 255, 0.12)'
              : 'rgba(255, 255, 255, 0.03)',
            borderWidth: 1,
            borderColor: isActive ? primaryColor : 'rgba(255, 255, 255, 0.08)',
          }}>
          {content}
        </TouchableOpacity>
      );
    }

    return (
      <Pressable
        accessibilityRole="button"
        focusable={isFocusable}
        isTVSelectable={isFocusable}
        hasTVPreferredFocus={isFocusable && isActive}
        onFocus={() => setTvFocused(true)}
        onBlur={() => setTvFocused(false)}
        onPress={onSelect}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 8,
          marginVertical: 4,
          borderRadius: 8,
          backgroundColor: tvFocused
            ? 'rgba(255, 255, 255, 0.16)'
            : isActive
              ? 'rgba(255, 255, 255, 0.12)'
              : 'rgba(255, 255, 255, 0.03)',
          // Fixed width so focus does not shift the row content.
          borderWidth: 2.5,
          borderColor: tvFocused
            ? focusBorderColor
            : isActive
              ? primaryColor
              : 'rgba(255, 255, 255, 0.08)',
        }}>
        {content}
      </Pressable>
    );
  },
);

export default SidebarEpisodeRow;

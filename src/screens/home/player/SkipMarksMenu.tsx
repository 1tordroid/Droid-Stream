import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {Modal, ScrollView, View} from 'react-native';
import {TVFocusable, TVFocusGuide} from '../../../components/tv';
import {RawText as Text} from '../../../components/ui/Text';
import type {SeasonMarks} from '../../../lib/playback/skipSegmentModel';
import {formatTVTimelineTime} from './playerHelpers';

export type MarkChoice = 'introStart' | 'introEnd' | 'creditsStart';

const ROWS: {id: MarkChoice; title: string; icon: string}[] = [
  {id: 'introStart', title: 'Intro starts here', icon: 'ray-start'},
  {id: 'introEnd', title: 'Intro ends here', icon: 'ray-end'},
  {id: 'creditsStart', title: 'Credits start here', icon: 'format-list-text'},
];

const shown = (value?: number) => (value === undefined ? 'Not set' : formatTVTimelineTime(value));

/** Lets the viewer mark the intro and credits of this episode for the whole season. */
export default function SkipMarksMenu({
  time,
  marks,
  seasonLabel,
  color,
  onMark,
  onClear,
  onClose,
}: {
  time: number;
  marks: SeasonMarks;
  seasonLabel: string;
  color: string;
  onMark: (choice: MarkChoice) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const values: Record<MarkChoice, number | undefined> = {
    introStart: marks.introStart ?? (marks.introEnd !== undefined ? 0 : undefined),
    introEnd: marks.introEnd,
    creditsStart: marks.creditsStart,
  };
  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    padding: 12,
    minHeight: 44,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: '#252525',
    borderWidth: 1,
    borderColor: '#333',
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 16}}>
        <TVFocusGuide
          trapFocusLeft
          trapFocusRight
          trapFocusUp
          trapFocusDown
          style={{width: '85%', maxWidth: 440, maxHeight: '90%', padding: 14, backgroundColor: '#171717', borderRadius: 20}}>
          <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 4}}>
            <Text numberOfLines={1} style={{color: 'white', fontSize: 16, fontWeight: '600', flex: 1}}>
              Mark intro and credits
            </Text>
            <TVFocusable
              registerScreenFocus={false}
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              focusBorderColor={color}
              borderRadius={22}
              style={{width: 44, height: 44, borderRadius: 22, backgroundColor: '#292929', alignItems: 'center', justifyContent: 'center'}}>
              <MaterialCommunityIcons name="close" size={22} color="#ddd" />
            </TVFocusable>
          </View>
          <Text style={{color: '#aaa', fontSize: 12, marginBottom: 12}}>
            Now at {formatTVTimelineTime(time)}. Used for every episode of {seasonLabel}.
          </Text>
          <ScrollView style={{flexShrink: 1}} showsVerticalScrollIndicator={false}>
            {ROWS.map((row, index) => (
              <TVFocusable
                key={row.id}
                registerScreenFocus={false}
                hasTVPreferredFocus={index === 0}
                accessibilityRole="button"
                accessibilityLabel={`${row.title}, now ${shown(values[row.id])}`}
                focusBorderColor={color}
                borderRadius={16}
                onPress={() => onMark(row.id)}
                style={rowStyle}>
                <View style={{width: 40, height: 40, borderRadius: 12, backgroundColor: '#323232', alignItems: 'center', justifyContent: 'center'}}>
                  <MaterialCommunityIcons name={row.icon as any} size={22} color="#eee" />
                </View>
                <View style={{flex: 1}}>
                  <Text numberOfLines={1} style={{color: '#eee', fontSize: 14}}>
                    {row.title}
                  </Text>
                  <Text numberOfLines={1} style={{color: '#aaa', fontSize: 12}}>
                    {shown(values[row.id])}
                  </Text>
                </View>
              </TVFocusable>
            ))}
            <TVFocusable
              registerScreenFocus={false}
              accessibilityRole="button"
              accessibilityLabel="Clear marks"
              focusBorderColor={color}
              borderRadius={16}
              onPress={onClear}
              style={{...rowStyle, marginBottom: 0}}>
              <View style={{width: 40, height: 40, borderRadius: 12, backgroundColor: '#323232', alignItems: 'center', justifyContent: 'center'}}>
                <MaterialCommunityIcons name="delete-outline" size={22} color="#eee" />
              </View>
              <Text numberOfLines={1} style={{color: '#eee', fontSize: 14, flex: 1}}>
                Clear marks
              </Text>
            </TVFocusable>
          </ScrollView>
        </TVFocusGuide>
      </View>
    </Modal>
  );
}

import React, {useEffect, useState} from 'react';
import {Pressable, View} from 'react-native';
import {useM3Colors} from '../theme/M3PaletteContext';
import AppText from './ui/Text';

type PendingUndo = {id: number; message: string; undo: () => void; commit: () => void};

let pending: PendingUndo | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export const showUndo = (message: string, undo: () => void, commit: () => void): void => {
  if (timer) clearTimeout(timer);
  pending?.commit();
  const id = Date.now();
  pending = {id, message, undo, commit};
  timer = setTimeout(() => {
    pending?.commit();
    pending = undefined;
    listeners.forEach(listener => listener());
  }, 5000);
  listeners.forEach(listener => listener());
};

const UndoSnackbar = () => {
  const colors = useM3Colors();
  const [, refresh] = useState(0);
  useEffect(() => {
    const listener = () => refresh(value => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  if (!pending) return null;
  const current = pending;
  return (
    <View style={{position: 'absolute', left: 16, right: 16, bottom: 24, backgroundColor: colors.inverseSurface, borderRadius: 16, minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
      <AppText style={{color: colors.inverseOnSurface, flex: 1}}>{current.message}</AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Undo"
        onPress={() => {
          if (timer) clearTimeout(timer);
          current.undo();
          pending = undefined;
          refresh(value => value + 1);
        }}
        style={{minHeight: 48, justifyContent: 'center', paddingLeft: 12}}>
        <AppText style={{color: colors.inversePrimary}}>Undo</AppText>
      </Pressable>
    </View>
  );
};

export default UndoSnackbar;

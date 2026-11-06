import React, {useMemo} from 'react';
import {View} from 'react-native';
import {vars} from 'nativewind';
import {getMaterialColors} from '@expo/ui/jetpack-compose';
import {M3_COLOR_ROLES, roleToCssVar} from './colors';
import {
  createCoherentAccentRoles,
  BRAND_SEED,
  DEFAULT_SEED,
  LEGACY_NEUTRAL_SURFACE_ROLES,
} from './seeds';
import {M3HostThemeContext, M3PaletteContext} from './M3PaletteContext';
import useThemeStore from '../lib/zustand/themeStore';
import {THEME_ROLES} from './themeMode';

export const FIXED_THEME_PRIMARY = '#E4E4E4';

export const M3ThemeProvider = ({children}: {children: React.ReactNode}) => {
  const primary = useThemeStore(state => state.primary);
  const source = useThemeStore(state => state.source);
  const mode = useThemeStore(state => state.mode);
  const palette = useMemo(() => {
    const generatedPalette = getMaterialColors({
      scheme: 'dark',
      ...(source === 'custom' ? {seedColor: primary} : {}),
    });
    const customAccentRoles =
      source === 'custom' && [DEFAULT_SEED, BRAND_SEED].includes(primary.toUpperCase())
        ? createCoherentAccentRoles(primary.toUpperCase())
        : {};
    return {
      ...generatedPalette,
      ...customAccentRoles,
      ...LEGACY_NEUTRAL_SURFACE_ROLES,
      ...THEME_ROLES[mode],
    } as const;
  }, [primary, source, mode]);
  const hostTheme = useMemo(
    () => ({
      colorScheme: 'dark' as const,
      ...(source === 'custom' ? {seedColor: primary} : {}),
    }),
    [primary, source],
  );

  const style = useMemo(() => {
    const entries = M3_COLOR_ROLES.map(role => [
      roleToCssVar(role),
      palette[role],
    ]);
    return vars(Object.fromEntries(entries));
  }, [palette]);

  return (
    <M3HostThemeContext.Provider value={hostTheme}>
      <M3PaletteContext.Provider value={palette}>
        <View style={[{flex: 1}, style]}>{children}</View>
      </M3PaletteContext.Provider>
    </M3HostThemeContext.Provider>
  );
};

export {useM3Colors} from './M3PaletteContext';

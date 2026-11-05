export type ThemeMode = 'amoled' | 'dark';

export const THEME_MODES: {id: ThemeMode; label: string; note: string; icon: 'circle' | 'weather-night'}[] = [
  {id: 'amoled', label: 'AMOLED black', note: 'Pure black, saves battery on OLED', icon: 'circle'},
  {id: 'dark', label: 'Soft dark', note: 'Dark gray instead of pure black', icon: 'weather-night'},
];

/** Background and text roles for each theme. Accent roles come from the palette. */
export const THEME_ROLES = {
  amoled: {
    background: '#000000',
    onBackground: '#F2F2F2',
    onSurface: '#F2F2F2',
    onSurfaceVariant: '#C4C4C4',
    outline: '#909090',
    outlineVariant: '#454545',
  },
  dark: {
    background: '#121212',
    onBackground: '#F2F2F2',
    surface: '#121212',
    surfaceDim: '#121212',
    surfaceBright: '#2E2E2E',
    surfaceContainerLowest: '#0E0E0E',
    surfaceContainerLow: '#1A1A1A',
    surfaceContainer: '#1E1E1E',
    surfaceContainerHigh: '#262626',
    surfaceContainerHighest: '#2E2E2E',
    surfaceVariant: '#2A2A2A',
    onSurface: '#F2F2F2',
    onSurfaceVariant: '#C4C4C4',
    outline: '#909090',
    outlineVariant: '#454545',
  },
} as const;

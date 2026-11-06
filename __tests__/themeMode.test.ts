import {THEME_MODES, THEME_ROLES} from '../src/theme/themeMode';

describe('theme mode', () => {
  it('offers only the two dark themes', () => {
    expect(THEME_MODES.map(mode => mode.id)).toEqual(['amoled', 'dark']);
  });

  it('uses pure black only for AMOLED', () => {
    expect(THEME_ROLES.amoled.background).toBe('#000000');
    expect(THEME_ROLES.dark.background).not.toBe('#000000');
  });
});

import {
  DIALOGUE_BOOST_OPTIONS,
  NIGHT_MODE_OPTIONS,
  audioEffectLabel,
  dialogueBoostNativeValue,
  nightModeNativeValue,
  normalizeDialogueBoost,
  normalizeNightMode,
  vlcAudioSourceOptions,
} from '../src/lib/player/audioEffects';

describe('night mode and dialogue boost choices', () => {
  it('maps every choice to the native preset the player expects', () => {
    expect(NIGHT_MODE_OPTIONS.map(option => nightModeNativeValue(option.value))).toEqual([0, 1, 2, 3]);
    expect(DIALOGUE_BOOST_OPTIONS.map(option => dialogueBoostNativeValue(option.value))).toEqual([0, 1, 2]);
  });

  it('falls back to Off for missing or unknown saved values', () => {
    expect(normalizeNightMode(undefined)).toBe('off');
    expect(normalizeNightMode('loud')).toBe('off');
    expect(normalizeNightMode(2)).toBe('off');
    expect(normalizeNightMode('strong')).toBe('strong');
    expect(normalizeDialogueBoost(null)).toBe('off');
    expect(normalizeDialogueBoost('medium')).toBe('off');
    expect(normalizeDialogueBoost('on')).toBe('on');
  });

  it('labels choices for the menus', () => {
    expect(audioEffectLabel(NIGHT_MODE_OPTIONS, 'medium')).toBe('Medium');
    expect(audioEffectLabel(DIALOGUE_BOOST_OPTIONS, 'strong')).toBe('Strong');
  });
});

describe('VLC night mode options', () => {
  it('keeps the old VLC source when night mode is off', () => {
    expect(vlcAudioSourceOptions('off')).toEqual({
      initOptions: ['--audio-time-stretch', '--sub-track=0'],
    });
  });

  it.each(['light', 'medium', 'strong'] as const)('starts libVLC with the compressor for %s', mode => {
    const {initType, initOptions} = vlcAudioSourceOptions(mode);
    // initType 2 is what makes the package hand initOptions to libVLC.
    expect(initType).toBe(2);
    // The package drops the last entry, so every effect option must come before it.
    expect(initOptions[initOptions.length - 1]).toBe('--sub-track=0');
    const passed = initOptions.slice(0, -1);
    expect(passed).toContain('--audio-filter=compressor');
    for (const name of ['threshold', 'ratio', 'knee', 'makeup-gain', 'attack', 'release', 'rms-peak']) {
      expect(passed.some(option => option.startsWith(`--compressor-${name}=`))).toBe(true);
    }
    // Whole numbers only, so no locale can misread a decimal separator.
    for (const option of passed.filter(item => item.startsWith('--compressor-'))) {
      expect(option).toMatch(/^--compressor-[a-z-]+=-?\d+$/);
    }
  });

  it('compresses harder for stronger presets', () => {
    const value = (mode: 'light' | 'medium' | 'strong', name: string) =>
      Number(
        vlcAudioSourceOptions(mode)
          .initOptions.find(option => option.startsWith(`--compressor-${name}=`))
          ?.split('=')[1],
      );
    expect(value('light', 'ratio')).toBeLessThan(value('medium', 'ratio'));
    expect(value('medium', 'ratio')).toBeLessThan(value('strong', 'ratio'));
    expect(value('light', 'threshold')).toBeGreaterThan(value('strong', 'threshold'));
    // libVLC accepts thresholds down to -30 dB.
    expect(value('strong', 'threshold')).toBeGreaterThanOrEqual(-30);
  });
});

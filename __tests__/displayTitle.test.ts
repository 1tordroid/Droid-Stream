import {displayTitle} from '../src/lib/displayTitle';

describe('displayTitle', () => {
  it('removes release details from provider titles', () => {
    expect(displayTitle('Black Doves (Season 1 – 2) NetFlix : Dual Audio {Hindi-English} 480p HD 720p')).toBe('Black Doves (Season 1 – 2)');
    expect(displayTitle('VisionQuest {S01E1-7 Added} JioHotstar : Dual Audio')).toBe('VisionQuest');
    expect(displayTitle('The Mongoose (2026) {Hindi-English} 480p WEB-DL x264 [400MB]')).toBe('The Mongoose (2026)');
  });

  it('leaves normal titles alone', () => {
    expect(displayTitle('The Mongoose (2026)')).toBe('The Mongoose (2026)');
    expect(displayTitle('Hindi Medium')).toBe('Hindi Medium');
    expect(displayTitle('[Group] Show')).toBe('[Group] Show');
  });
});

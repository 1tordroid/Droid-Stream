import {applyMirrors, isMirrorableUrl, validateMirrorRule, type MirrorRule} from '../src/lib/downloadEngine/mirrors';

const rule = (match: string, mirror: string, id = match): MirrorRule => ({id, match, mirror});

describe('mirror rules', () => {
  it('applies only to GitHub and Hugging Face hosts', () => {
    expect(isMirrorableUrl('https://github.com/a/b/releases/download/v1/x.zip')).toBe(true);
    expect(isMirrorableUrl('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isMirrorableUrl('https://raw.githubusercontent.com/a/b/main/c')).toBe(true);
    expect(isMirrorableUrl('https://huggingface.co/m/resolve/main/f.gguf')).toBe(true);
    expect(isMirrorableUrl('https://example.com/github.com/x')).toBe(false);
    expect(isMirrorableUrl('https://github.com.evil.example/x')).toBe(false);
    expect(applyMirrors('https://example.com/x', [rule('https://example.com/', 'https://m/')])).toBeUndefined();
  });

  it('replaces a URL prefix with the mirror prefix', () => {
    const rules = [rule('https://github.com/', 'https://my-mirror/https://github.com/')];
    expect(applyMirrors('https://github.com/a/b/archive/main.zip', rules)).toBe('https://my-mirror/https://github.com/a/b/archive/main.zip');
  });

  it('treats a host rule as its https:// and http:// prefix', () => {
    const rules = [rule('huggingface.co', 'https://hf-mirror.example')];
    expect(applyMirrors('https://huggingface.co/org/model/resolve/main/a.bin?download=true', rules)).toBe(
      'https://hf-mirror.example/org/model/resolve/main/a.bin?download=true',
    );
    expect(applyMirrors('http://HuggingFace.co/x', rules)).toBe('https://hf-mirror.example/x');
    expect(applyMirrors('https://raw.githubusercontent.com/x', rules)).toBeUndefined();
  });

  it('uses the longest matching rule', () => {
    const rules = [
      rule('github.com', 'https://general.example/'),
      rule('https://github.com/big-org/', 'https://org-mirror.example/'),
    ];
    expect(applyMirrors('https://github.com/big-org/repo/x', rules)).toBe('https://org-mirror.example/repo/x');
    expect(applyMirrors('https://github.com/other/repo/x', rules)).toBe('https://general.example/other/repo/x');
  });

  it('returns nothing when no rule matches or there are no rules', () => {
    expect(applyMirrors('https://github.com/a', [])).toBeUndefined();
    expect(applyMirrors('https://github.com/a', [rule('raw.githubusercontent.com', 'https://m/')])).toBeUndefined();
  });

  it('checks what the user typed', () => {
    expect(validateMirrorRule('github.com', 'https://m.example/')).toEqual({rule: {match: 'github.com', mirror: 'https://m.example/'}});
    expect(validateMirrorRule(' GitHub.com/ ', 'https://m.example/')).toEqual({rule: {match: 'github.com', mirror: 'https://m.example/'}});
    expect(validateMirrorRule('https://github.com/', 'https://m.example/https://github.com/')).toEqual({
      rule: {match: 'https://github.com/', mirror: 'https://m.example/https://github.com/'},
    });
    expect(validateMirrorRule('example.com', 'https://m/')).toHaveProperty('error');
    expect(validateMirrorRule('github.com', 'ftp://m/')).toHaveProperty('error');
    expect(validateMirrorRule('', '')).toHaveProperty('error');
  });
});

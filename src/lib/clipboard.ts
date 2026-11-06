import * as ExpoClipboard from 'expo-clipboard';

/** Copies text to the clipboard. Failures are logged, never thrown. */
export function copyText(text: string): void {
  ExpoClipboard.setStringAsync(text).catch(error =>
    console.warn('Copy to clipboard failed', error),
  );
}

/** Text on the clipboard, or an empty string when it cannot be read. */
export async function readText(): Promise<string> {
  try {
    return (await ExpoClipboard.getStringAsync()) || '';
  } catch {
    return '';
  }
}

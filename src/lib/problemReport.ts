import * as FileSystem from 'expo-file-system/legacy';
import {Platform} from 'react-native';
import {currentEdition, editionName, versionWithBuild} from './appVersion';
import {socialLinks} from './constants';
import {flushPendingLogs} from './logging/vegaLog';

/**
 * "Send a problem report": a prefilled GitHub issue the user reads, changes
 * and sends themselves. Nothing is sent by the app. Logs are added only when
 * the user ticks the box, and are scrubbed first.
 */

export const ISSUE_URL = `${socialLinks.github}/issues/new`;
/** GitHub refuses issue links much past 8 KB, so the link stays below this. */
export const MAX_ISSUE_URL_LENGTH = 7800;
export const REPORT_LOG_LINES = 150;
const MAX_LOG_LINE = 300;

// --- Scrubbing ---

const SECRET_KEY = '[\\w-]*?(?:token|secret|password|passwd|api[_-]?key|apikey|session[_-]?id|sessionid|cookie|authorization|signature|credential)[\\w-]*';

const RULES: [RegExp, string | ((match: string, ...groups: string[]) => string)][] = [
  // Links keep the address but lose the query and fragment (tokens, ids, search words).
  [/\b((?:https?|wss?|ftp|rtmp|rtsp|smb|magnet):[^\s?#"'<>]*)[?#][^\s"'<>]*/gi, '$1?…'],
  [/\b(?:file|content):\/\/[^\s"'<>]+/gi, '<path>'],
  // Sign-in headers and cookies.
  [/\b(set-cookie|cookie)\s*[:=]\s*[^\n]*/gi, '$1: <hidden>'],
  [/\b((?:proxy-)?authorization)(["']?\s*[:=]\s*)["']?[^"'\n,}]+/gi, '$1$2<hidden>'],
  [/\bbearer\s+[\w.~+/=-]+/gi, 'Bearer <hidden>'],
  // "token": "…", password=…, x-api-key: … (the name stays, the value goes).
  [new RegExp(`(["']?)\\b(${SECRET_KEY})\\1(\\s*[:=]\\s*)(["']?)[^"'\\s,;&}\\]]+\\4`, 'gi'), '$1$2$1$3$4<hidden>$4'],
  [/\b(otp|pin|sid)(\s*[:=]\s*)["']?[^"'\s,;&}\]]+["']?/gi, '$1$2<hidden>'],
  // Tokens that need no name: JWTs and long hex or base64 strings.
  [/\beyJ[\w-]{8,}\.[\w-]{8,}(?:\.[\w-]*)?/g, '<token>'],
  [/\b[a-f0-9]{32,}\b/gi, '<id>'],
  [/[A-Za-z0-9+_-]{40,}={0,2}/g, match => (/\d/.test(match) && /[A-Za-z]/.test(match) ? '<id>' : match)],
  [/[\w.%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>'],
  // File paths on the phone (and on a PC, in case one is pasted into a log).
  [/(^|[\s"'(=:,[])\/(?:data|storage|sdcard|mnt|system|apex|proc|vendor|product|cache|Android)\/[^\s"'),\]]*/gm, '$1<path>'],
  [/\b[A-Za-z]:\\[^\s"']+/g, '<path>'],
  // IP addresses.
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>'],
  [
    /(^|[^\w:.])((?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4})(?![\w:])/gi,
    (match, before, address) => (/::|[a-f]/i.test(address) && address.length > 3 ? `${before}<ip>` : match),
  ],
  // Phone numbers.
  [/\+\d[\d -]{8,14}\d\b/g, '<number>'],
  [/\b[6-9]\d{9}\b/g, '<number>'],
];

/** Removes tokens, cookies, emails, IP addresses, link queries, file paths and phone numbers. */
export const scrubLog = (text: string): string =>
  RULES.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement as string), text);

// --- The app's own log ---

const logFile = (name: string) => `${FileSystem.documentDirectory}logs/${name}`;

/**
 * The newest lines of the app's log (VegaLog keeps vega-0.log and the
 * older vega-1.log in files/logs), oldest first and not yet scrubbed.
 */
export const readRecentLogs = async (count = REPORT_LOG_LINES): Promise<string[]> => {
  flushPendingLogs();
  // VegaLog writes on its own thread; give it a moment for what was just flushed.
  await new Promise(resolve => setTimeout(resolve, 250));
  const read = (name: string) => FileSystem.readAsStringAsync(logFile(name)).catch(() => '');
  const lines = (text: string) => text.split(/\r?\n/).filter(line => line.trim());
  let recent = lines(await read('vega-0.log'));
  if (recent.length < count) recent = [...lines(await read('vega-1.log')), ...recent];
  return recent.slice(-count);
};

// --- The issue ---

export interface DeviceInfo {
  android: string;
  device: string;
}

export const deviceInfo = (): DeviceInfo => {
  const constants = (Platform.constants || {}) as {Release?: string; Model?: string; Manufacturer?: string};
  const sdk = typeof Platform.Version === 'number' ? Platform.Version : undefined;
  const release = constants.Release ? `Android ${constants.Release}` : 'Android';
  const maker = constants.Manufacturer || '';
  const model = constants.Model || '';
  const device = model.toLowerCase().startsWith(maker.toLowerCase()) ? model : `${maker} ${model}`.trim();
  return {android: sdk ? `${release} (SDK ${sdk})` : release, device: device || 'Unknown'};
};

export interface ReportInput {
  logs?: string[];
  error?: {message?: string; stack?: string};
  device?: DeviceInfo;
  app?: {name: string; edition: string; version: string};
  maxLength?: number;
}

export interface ProblemReport {
  url: string;
  title: string;
  body: string;
  /** Older log lines were left out to keep the link short enough. */
  trimmed: boolean;
  logLines: number;
  /** All the scrubbed log lines, for Copy logs. */
  logText: string;
}

const fence = (text: string) => text.replace(/```/g, "'''");

export const issueUrl = (title: string, body: string): string =>
  `${ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;

export const buildProblemReport = ({
  logs,
  error,
  device = deviceInfo(),
  app = {name: editionName(), edition: currentEdition(), version: versionWithBuild() || 'unknown'},
  maxLength = MAX_ISSUE_URL_LENGTH,
}: ReportInput = {}): ProblemReport => {
  const message = error?.message ? scrubLog(error.message).replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  const title = message ? `App error: ${message.slice(0, 80)}` : `Problem in ${app.name} ${app.version}`;
  const parts = [
    '### What happened?',
    '',
    'Describe the problem and the steps that lead to it.',
    '',
    '### App',
    `- ${app.name} (${app.edition})`,
    `- Version ${app.version}`,
    `- ${device.android}`,
    `- Device: ${device.device}`,
  ];
  if (error) {
    const stack = scrubLog(error.stack || '')
      .split('\n')
      .slice(0, 8)
      .map(line => line.slice(0, 200))
      .join('\n');
    parts.push('', '### Error', '```', fence(message || 'Unknown error'), ...(stack ? [fence(stack)] : []), '```');
  }
  const base = parts.join('\n');
  const lines = (logs || []).map(line => scrubLog(line).slice(0, MAX_LOG_LINE)).slice(-REPORT_LOG_LINES);
  const logText = lines.join('\n');

  const withLogs = (count: number) => {
    if (!logs) return base;
    const kept = lines.slice(lines.length - count);
    const note = count < lines.length ? `\n(Trimmed: ${lines.length - count} older lines left out. Use Copy logs in the app to paste them all.)` : '';
    return [
      base,
      '',
      '### Recent logs',
      'Sign-ins, cookies, emails, IP addresses, link details and file paths were removed.',
      '```text',
      fence(kept.join('\n')),
      '```' + note,
    ].join('\n');
  };
  const fits = (count: number) => issueUrl(title, withLogs(count)).length <= maxLength;

  // The most recent lines that fit in the link.
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  const body = withLogs(low);
  return {url: issueUrl(title, body), title, body, trimmed: low < lines.length, logLines: low, logText};
};

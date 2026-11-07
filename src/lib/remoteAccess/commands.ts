/**
 * Command access: broadcasts from Termux, ADB or Tasker that add, pause,
 * resume or list downloads. Each one must carry the token from Settings.
 */
import {aria2StatusOf, gidFor} from './aria2Status';
import type {DownloadItem} from '../zustand/downloadsStore';

/** The actions stay the same in every edition; the package name picks the edition. */
export const COMMAND_PREFIX = 'com.tordroid.droidstream.';
export const COMMAND_ACTIONS = ['ADD_DOWNLOAD', 'PAUSE', 'RESUME', 'LIST'] as const;
export type CommandAction = (typeof COMMAND_ACTIONS)[number];

export type RemoteCommand =
  | {kind: 'add'; url: string; name?: string}
  | {kind: 'pause'; target: string}
  | {kind: 'resume'; target: string}
  | {kind: 'list'};

const LINK = /^(https?|ftps?|ftpes):\/\/[^\s]+$|^magnet:\?[^\s]+$|^ed2k:\/\/\|[^\s]+$/i;

/** True for links command access may add. */
export const isCommandLink = (value: string): boolean => value.length <= 8192 && LINK.test(value);

/** Reads one broadcast. [extras] are the intent's string extras. */
export const parseCommand = (action: string, extras: Record<string, unknown>): RemoteCommand | {error: string} => {
  const name = action.startsWith(COMMAND_PREFIX) ? action.slice(COMMAND_PREFIX.length) : action;
  const text = (key: string) => (typeof extras[key] === 'string' ? (extras[key] as string).trim() : '');
  switch (name) {
    case 'ADD_DOWNLOAD': {
      const url = text('url');
      if (!url) return {error: 'Add a url extra with the link to download.'};
      if (!isCommandLink(url)) return {error: 'Only http, https, ftp, magnet and ed2k links can be added.'};
      const fileName = text('name').replace(/[\\/]/g, '_').slice(0, 200);
      return fileName ? {kind: 'add', url, name: fileName} : {kind: 'add', url};
    }
    case 'PAUSE':
    case 'RESUME': {
      const target = text('id') || 'all';
      if (target !== 'all' && !/^[A-Za-z0-9._:-]{1,200}$/.test(target)) return {error: 'The id extra is not valid.'};
      return {kind: name === 'PAUSE' ? 'pause' : 'resume', target};
    }
    case 'LIST':
      return {kind: 'list'};
    default:
      return {error: `Unknown action ${action}.`};
  }
};

/** True when [target] ("all", a download id or its aria2 GID) names [item]. */
export const commandTargets = (target: string, item: DownloadItem): boolean =>
  target === 'all' || target === item.id || target.toLowerCase() === gidFor(item.id);

/** The LIST answer: one line per current download. */
export const formatCommandList = (items: DownloadItem[]): string => {
  if (items.length === 0) return 'No downloads.';
  return items
    .map(item => {
      const percent = item.totalBytes > 0 ? Math.min(100, Math.floor((item.downloadedBytes / item.totalBytes) * 100)) : 0;
      return `${gidFor(item.id)} ${aria2StatusOf(item.status)} ${percent}% ${item.displayFileName || item.title}`;
    })
    .join('\n');
};

/** Single quotes for a shell, so links with & and ? stay one argument. */
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export interface CommandExamples {
  add: string;
  pause: string;
  resume: string;
  list: string;
  adb: string;
}

/** Commands to copy, with this edition's package name and the user's token. */
export const commandExamples = (packageName: string, token: string, link = 'https://example.com/video.mp4'): CommandExamples => {
  const base = (action: CommandAction) => `am broadcast -a ${COMMAND_PREFIX}${action} -p ${packageName} --es token ${quote(token)}`;
  return {
    add: `${base('ADD_DOWNLOAD')} --es url ${quote(link)}`,
    pause: `${base('PAUSE')} --es id all`,
    resume: `${base('RESUME')} --es id all`,
    list: base('LIST'),
    // The outer double quotes keep the inner single quotes for the phone's shell.
    adb: `adb shell "${base('ADD_DOWNLOAD')} --es url ${quote(link)}"`,
  };
};

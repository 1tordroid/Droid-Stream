import {NativeModules} from 'react-native';

export interface SmbEntry {
  name: string;
  directory: boolean;
  size: number;
}

export const listSmbShare = async (
  host: string,
  share: string,
  path: string,
  username: string,
  password: string,
): Promise<SmbEntry[]> => {
  const module = NativeModules.SmbModule;
  if (!module?.list) {
    throw new Error('SMB needs a build that includes the local SMB module.');
  }
  return module.list(host, share, path, username, password, '');
};

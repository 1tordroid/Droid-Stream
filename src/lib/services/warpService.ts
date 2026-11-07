import { NativeModules, Platform } from 'react-native';

// Smart unblock (lib/unblock/unblockService) decides when WARP runs.
const { WarpModule } = NativeModules;

export interface WarpStatus {
  running: boolean;
  port?: number;
}

export const isWarpSupported = (): boolean => {
  return Platform.OS === 'android' && Boolean(WarpModule);
};

export const startWarp = async (): Promise<WarpStatus> => {
  if (!isWarpSupported()) {
    return { running: false };
  }
  return await WarpModule.startWarp();
};

export const stopWarp = async (): Promise<WarpStatus> => {
  if (!isWarpSupported()) {
    return { running: false };
  }
  return await WarpModule.stopWarp();
};

export const getWarpStatus = async (): Promise<WarpStatus> => {
  if (!isWarpSupported()) {
    return { running: false };
  }
  return await WarpModule.getStatus();
};

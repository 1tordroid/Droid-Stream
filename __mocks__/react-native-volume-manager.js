// The real module builds NativeEventEmitters at import time, which throws
// without the native binary.
const VolumeManager = {
  getVolume: jest.fn(async () => ({volume: 0.5})),
  setVolume: jest.fn(async () => undefined),
  addVolumeListener: jest.fn(() => ({remove: jest.fn()})),
  showNativeVolumeUI: jest.fn(async () => undefined),
};
module.exports = {VolumeManager, default: VolumeManager};

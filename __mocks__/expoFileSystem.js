// expo-file-system needs the native Expo runtime. Tests only need the shape.
const ok = jest.fn(async () => undefined);
module.exports = {
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  EncodingType: {UTF8: 'utf8', Base64: 'base64'},
  getInfoAsync: jest.fn(async () => ({exists: false, isDirectory: false, size: 0})),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: ok,
  deleteAsync: ok,
  moveAsync: ok,
  copyAsync: ok,
  makeDirectoryAsync: ok,
  readDirectoryAsync: jest.fn(async () => []),
  downloadAsync: jest.fn(async () => ({status: 200})),
  createDownloadResumable: jest.fn(() => ({downloadAsync: jest.fn(async () => ({status: 200})), pauseAsync: ok, resumeAsync: ok})),
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(async () => ({granted: false})),
    readDirectoryAsync: jest.fn(async () => []),
    createFileAsync: jest.fn(async () => ''),
    getUriForDirectoryInRoot: jest.fn(() => ''),
  },
  Paths: {document: {uri: 'file:///documents/'}, cache: {uri: 'file:///cache/'}},
  File: class {},
  Directory: class {},
};

// The published package ships ESM only; tests never touch the real file system.
const noop = jest.fn(async () => undefined);
module.exports = {
  DocumentDirectoryPath: '/documents',
  DownloadDirectoryPath: '/downloads',
  CachesDirectoryPath: '/cache',
  ExternalDirectoryPath: '/external',
  ExternalStorageDirectoryPath: '/storage',
  TemporaryDirectoryPath: '/tmp',
  exists: jest.fn(async () => false),
  stat: jest.fn(async () => ({size: 0, isFile: () => true, isDirectory: () => false})),
  readDir: jest.fn(async () => []),
  readFile: jest.fn(async () => ''),
  writeFile: noop,
  appendFile: noop,
  mkdir: noop,
  unlink: noop,
  moveFile: noop,
  copyFile: noop,
  hash: jest.fn(async () => ''),
  downloadFile: jest.fn(() => ({jobId: 1, promise: Promise.resolve({statusCode: 200, bytesWritten: 0})})),
  stopDownload: jest.fn(),
};

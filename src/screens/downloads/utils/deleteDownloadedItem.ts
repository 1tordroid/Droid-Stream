import {
  deleteDownloadOutput,
  downloadOutputExists,
} from '../../../lib/downloadDestination';
import {
  getDownloadDirectoryNames,
} from '../../../lib/downloadId';
import type {DownloadItem} from '../../../lib/zustand/downloadsStore';
import useDownloadsStore from '../../../lib/zustand/downloadsStore';

export const deleteDownloadedItemAndSubtitles = async (
  item: DownloadItem,
): Promise<void> => {
  const allDownloads = Object.values(useDownloadsStore.getState().downloads);
  const removeDownload = useDownloadsStore.getState().removeDownload;

  const subItems = allDownloads.filter(
    d =>
      d.id.startsWith(`${item.id}_subtitle_`) ||
      (d.infoUrl === item.infoUrl &&
        d.sourceLink === item.sourceLink &&
        (d.isSubtitle || d.id.includes('_subtitle_'))),
  );
  for (const subItem of subItems) {
    if (subItem.filePath) {
      await deleteDownloadOutput(subItem.filePath, {
        downloadLocation: subItem.downloadLocation,
        outputDirectoryNames: getDownloadDirectoryNames(subItem),
      }).catch(() => undefined);
    }
    removeDownload(subItem.id);
  }

  const deleted = await deleteDownloadOutput(item.filePath, {
    downloadLocation: item.downloadLocation,
    outputDirectoryNames: getDownloadDirectoryNames(item),
  });
  if (deleted || !(await downloadOutputExists(item.filePath))) {
    removeDownload(item.id);
  }
};

import {deleteDownloadOutput} from '../../../lib/downloadDestination';
import {
  getDownloadDirectoryNames,
} from '../../../lib/downloadId';
import type {DownloadedMediaGroup} from '../../../lib/downloadLibrary';
import useDownloadsStore from '../../../lib/zustand/downloadsStore';

export const deleteDownloadedMediaGroups = async (
  targetGroups: DownloadedMediaGroup[],
): Promise<void> => {
  const allDownloads = Object.values(useDownloadsStore.getState().downloads);
  const removeDownload = useDownloadsStore.getState().removeDownload;

  for (const group of targetGroups) {
    for (const item of group.items) {
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

      if (item.filePath) {
        await deleteDownloadOutput(item.filePath, {
          downloadLocation: item.downloadLocation,
          outputDirectoryNames: getDownloadDirectoryNames(item),
        }).catch(() => undefined);
      }
      removeDownload(item.id);
    }
  }
};

import {Linking, ToastAndroid} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import * as Application from 'expo-application';
import {notificationService} from '../services/Notification';
import {settingsStorage} from '../storage';
import {showAppDialog} from '../zustand/appDialogStore';
import {isTV} from '../tv';
import {
  GithubRelease,
  UPDATE_REPOSITORY,
  UPDATE_RELEASES_URL,
  compareVersions,
  selectReleaseApk,
  stripVersionTag,
} from './release';

const deletePartialFile = async (filePath: string) => {
  try {
    if (await RNFS.exists(filePath)) {
      await RNFS.unlink(filePath);
    }
  } catch {}
};

export const downloadUpdate = async (url: string, name: string) => {
  console.log('downloading', url, name);
  await notificationService.requestPermission();

  const filePath = `${RNFS.CachesDirectoryPath}/${name}`;
  let expectedSize = 0;

  const {promise} = RNFS.downloadFile({
    fromUrl: url,
    background: true,
    progressInterval: 1000,
    progressDivider: 1,
    toFile: filePath,
    begin: res => {
      expectedSize = res.contentLength;
      console.log('begin', res.jobId, res.statusCode, res.contentLength);
    },
    progress: res => {
      notificationService.showUpdateProgress(
        'Downloading update',
        `Version ${Application.nativeApplicationVersion} -> ${name}`,
        {
          current: res.bytesWritten,
          max: res.contentLength,
          indeterminate: false,
        },
      );
    },
  });

  try {
    const res = await promise;
    await notificationService.cancelNotification('updateProgress');

    if (res.statusCode !== 200 || res.bytesWritten < expectedSize) {
      console.log(
        `[update] Download failed: status=${res.statusCode}, bytes=${res.bytesWritten}/${expectedSize}`,
      );
      await deletePartialFile(filePath);
      ToastAndroid.show('Download failed, please try again', ToastAndroid.SHORT);
      return;
    }

    await notificationService.displayUpdateNotification({
      id: 'downloadComplete',
      title: 'Download complete',
      body: 'Tap to install',
      data: {filePath, action: 'install'},
    });
    await notificationService.installUpdate(filePath);
  } catch (error) {
    console.log('[update] Download error:', error);
    await notificationService.cancelNotification('updateProgress');
    await deletePartialFile(filePath);
    ToastAndroid.show('Download failed, please try again', ToastAndroid.SHORT);
  }
};

const releaseNotes = (release: GithubRelease, remoteLabel: string): string => {
  const notes = release.body?.trim();
  return notes && notes.length > 0
    ? notes
    : `Droid Stream ${remoteLabel} is available.`;
};

/**
 * Compare the installed version with the latest stable GitHub Release of
 * 1tordroid/Droid-Stream. Automatic checks stay quiet when the user skipped
 * that tag. A manual check from Settings still shows it.
 */
export const checkForUpdate = async (
  setUpdateLoading: (loading: boolean) => void,
  autoDownload: boolean,
  showToast = true,
) => {
  setUpdateLoading(true);
  const manual = showToast;
  try {
    const res = await fetch(UPDATE_RELEASES_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'DroidStream',
      },
    });
    if (res.status === 403 || res.status === 429) {
      ToastAndroid.show(
        'GitHub API rate limit exceeded. Please wait a few minutes before trying again.',
        ToastAndroid.LONG,
      );
      setUpdateLoading(false);
      return;
    }
    if (!res.ok) {
      throw new Error(`GitHub release check failed with status ${res.status}`);
    }
    const data = (await res.json()) as GithubRelease;
    if (!data?.tag_name) {
      throw new Error('Invalid release data received from GitHub');
    }
    const localVersion = Application.nativeApplicationVersion || '';
    const remoteLabel = stripVersionTag(data.tag_name);
    const skipped = settingsStorage.getSkippedUpdateTag();
    if (!manual && skipped && skipped === data.tag_name) {
      setUpdateLoading(false);
      return;
    }
    if (compareVersions(localVersion, remoteLabel)) {
      const apkAsset = selectReleaseApk(data.assets, isTV);
      const startDownload = (): Promise<unknown> => {
        if (apkAsset?.browser_download_url && apkAsset.name) {
          return downloadUpdate(apkAsset.browser_download_url, apkAsset.name);
        }
        if (data.html_url) {
          return Linking.openURL(data.html_url);
        }
        ToastAndroid.show(
          `No APK was attached to ${UPDATE_REPOSITORY} ${data.tag_name}`,
          ToastAndroid.LONG,
        );
        return Promise.resolve();
      };
      if (!manual && autoDownload && apkAsset?.browser_download_url && apkAsset.name) {
        startDownload().catch(error => console.log('Update error', error));
      }
      ToastAndroid.show('New update available', ToastAndroid.SHORT);
      showAppDialog({
        title: `Update v${localVersion} -> ${data.tag_name}`,
        message: releaseNotes(data, remoteLabel),
        messageFormat: 'markdown',
        actions: [
          {
            label: 'Skip this version',
            onPress: () => settingsStorage.setSkippedUpdateTag(data.tag_name!),
          },
          {label: 'Not now'},
          {
            label: 'Download and install',
            variant: 'primary',
            onPress: () => {
              startDownload().catch(error => console.log('Update error', error));
            },
          },
        ],
      });
    } else if (showToast) {
      ToastAndroid.show('App is up to date', ToastAndroid.SHORT);
    }
  } catch (error) {
    const isRateLimit =
      error instanceof Error && error.message.toLowerCase().includes('rate limit');
    const msg = isRateLimit
      ? 'GitHub API rate limit exceeded. Please wait a few minutes before trying again.'
      : 'Failed to check for update';
    ToastAndroid.show(msg, ToastAndroid.SHORT);
    console.log('Update error', error);
  }
  setUpdateLoading(false);
};

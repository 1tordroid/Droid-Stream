import {Linking, NativeModules, ToastAndroid} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import {notificationService} from '../services/Notification';
import {settingsStorage} from '../storage';
import {showAppDialog} from '../zustand/appDialogStore';
import {
  AppBuild,
  GithubRelease,
  UPDATE_REPOSITORY,
  UPDATE_RELEASES_LIST_URL,
  UPDATE_RELEASES_URL,
  buildLabel,
  installedBuild,
  isAllowedUpdateUrl,
  pickUpdate,
} from './release';
import {verifyApkDigest} from './verifyApk';
import {currentEdition} from '../appVersion';

const deletePartialFile = async (filePath: string) => {
  try {
    if (await RNFS.exists(filePath)) {
      await RNFS.unlink(filePath);
    }
  } catch {}
};

/** The CPU types this device runs, best first, from the native module. */
const supportedAbis = (): string[] => {
  const raw = NativeModules.VegaDeviceMemory?.getConstants?.()?.supportedAbis ?? NativeModules.VegaDeviceMemory?.supportedAbis;
  return typeof raw === 'string' ? raw.split(',').filter(Boolean) : [];
};

export const downloadUpdate = async (
  url: string,
  name: string,
  digest?: string | null,
) => {
  console.log('downloading', url, name);
  if (!isAllowedUpdateUrl(url)) {
    console.log('[update] Refusing download from', url);
    ToastAndroid.show('Update link is not from GitHub', ToastAndroid.LONG);
    return;
  }
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

    if ((await verifyApkDigest(filePath, digest)) === 'mismatch') {
      console.log('[update] SHA-256 mismatch, deleting', filePath);
      await deletePartialFile(filePath);
      ToastAndroid.show(
        'Update file is damaged or changed, please try again',
        ToastAndroid.LONG,
      );
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

/** This build, as the updater sees it. Releases give a stable build its date. */
export const currentBuild = (releases: GithubRelease[] = []): AppBuild =>
  installedBuild(
    Application.nativeApplicationVersion || '',
    Constants.expoConfig?.extra,
    releases,
  );

/** Shown when beta builds are turned off on a nightly build. */
export const LEAVE_BETA_MESSAGE =
  "You're on a nightly build. You'll get the next stable release when it is newer.";

const releaseNotes = (release: GithubRelease, remoteLabel: string): string => {
  const notes = release.body?.trim();
  return notes && notes.length > 0
    ? notes
    : `Droid Stream ${remoteLabel} is available.`;
};

/**
 * Compare the installed build with the GitHub Releases of
 * 1tordroid/Droid-Stream: the latest stable release, plus the nightly builds
 * (pre-releases) when "Get beta builds" is on. See pickUpdate for the rules;
 * an older build is never offered. Automatic checks stay quiet when the user
 * skipped that tag. A manual check from Settings still shows it.
 */
export const checkForUpdate = async (
  setUpdateLoading: (loading: boolean) => void,
  autoDownload: boolean,
  showToast = true,
) => {
  setUpdateLoading(true);
  const manual = showToast;
  const beta = settingsStorage.isBetaUpdatesEnabled();
  try {
    const res = await fetch(beta ? UPDATE_RELEASES_LIST_URL : UPDATE_RELEASES_URL, {
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
    const payload = (await res.json()) as GithubRelease | GithubRelease[];
    const releases = Array.isArray(payload) ? payload : [payload];
    if (!releases.some(release => release?.tag_name)) {
      throw new Error('Invalid release data received from GitHub');
    }
    const localVersion = Application.nativeApplicationVersion || '';
    const installed = currentBuild(releases);
    const choice = pickUpdate(releases, installed, {
      beta,
      edition: currentEdition(),
      supportedAbis: supportedAbis(),
    });
    const data = choice?.release;
    const skipped = settingsStorage.getSkippedUpdateTag();
    if (!manual && data && skipped && skipped === data.tag_name) {
      setUpdateLoading(false);
      return;
    }
    if (choice && data?.tag_name) {
      const remoteLabel = buildLabel(choice.build);
      const apkAsset = choice.asset;
      const startDownload = (): Promise<unknown> => {
        if (apkAsset?.browser_download_url && apkAsset.name) {
          return downloadUpdate(
            apkAsset.browser_download_url,
            apkAsset.name,
            apkAsset.digest,
          );
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
        title: `Update ${localVersion ? buildLabel(installed) : 'this build'} -> ${remoteLabel}`,
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
      ToastAndroid.show(
        !beta && installed.channel === 'nightly' ? LEAVE_BETA_MESSAGE : 'App is up to date',
        ToastAndroid.SHORT,
      );
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

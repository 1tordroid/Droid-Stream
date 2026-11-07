/**
 * Programme reminders: a notification shortly before a future programme
 * starts. Uses an inexact alarm, so no exact-alarm permission is needed; it
 * may arrive a minute or two late on a sleeping device.
 */
import notifee, {AlarmType, AndroidImportance, AuthorizationStatus, TriggerType} from '@notifee/react-native';
import RNApkInstaller from '@himanshu8443/react-native-apk-installer';
import {formatClock, MINUTE, type GuideProgramme} from './guide';
import {hashText} from './guideLoader';
import {readLiveJson, writeLiveJson} from './store';

const CHANNEL_ID = 'livetv-reminders';
const KEY = 'reminders';
const LEAD_MS = 2 * MINUTE;

interface Reminder {
  id: string;
  start: number;
}

export const reminderId = (channelKey: string, start: number) => `livetv-${hashText(channelKey)}-${start}`;

const list = (now = Date.now()): Reminder[] => (readLiveJson<Reminder[]>(KEY) || []).filter(item => item.start > now);

export const hasReminder = (id: string) => list().some(item => item.id === id);
export const reminderIds = (): Set<string> => new Set(list().map(item => item.id));

const allowed = async () => {
  const ok = (status: AuthorizationStatus) => status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL;
  if (ok((await notifee.getNotificationSettings()).authorizationStatus)) return true;
  return ok((await notifee.requestPermission()).authorizationStatus);
};

export type ReminderResult = 'set' | 'removed' | 'denied' | 'too-late';

/** Sets a reminder for a future programme, or removes the one already set. */
export const toggleReminder = async (channelKey: string, channelName: string, programme: GuideProgramme): Promise<ReminderResult> => {
  const id = reminderId(channelKey, programme.start);
  const current = list();
  if (current.some(item => item.id === id)) {
    await notifee.cancelTriggerNotification(id).catch(() => undefined);
    writeLiveJson(KEY, current.filter(item => item.id !== id));
    return 'removed';
  }
  const fireAt = Math.max(Date.now() + 5000, programme.start - LEAD_MS);
  if (programme.start <= Date.now() + 30_000) return 'too-late';
  if (!(await allowed())) return 'denied';
  await notifee.createChannel({id: CHANNEL_ID, name: 'Live TV reminders', importance: AndroidImportance.HIGH});
  await notifee.createTriggerNotification(
    {
      id,
      title: programme.title,
      body: `Starts at ${formatClock(programme.start)} on ${channelName}`,
      android: {
        channelId: CHANNEL_ID,
        smallIcon: 'ic_notification',
        pressAction: {id: 'default', launchActivity: `${RNApkInstaller.packageName}.MainActivity`},
      },
    },
    {type: TriggerType.TIMESTAMP, timestamp: fireAt, alarmManager: {type: AlarmType.SET_AND_ALLOW_WHILE_IDLE}},
  );
  writeLiveJson(KEY, [...current, {id, start: programme.start}]);
  return 'set';
};

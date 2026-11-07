import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    getNotificationSettings: jest.fn(async () => ({authorizationStatus: 0})),
    requestPermission: jest.fn(async () => ({authorizationStatus: 1})),
    getTriggerNotificationIds: jest.fn(async () => [] as string[]),
    cancelTriggerNotification: jest.fn(async () => undefined),
    createChannel: jest.fn(async () => 'new-episodes'),
    createTriggerNotification: jest.fn(async () => 'id'),
  },
  AlarmType: {SET_AND_ALLOW_WHILE_IDLE: 3},
  AndroidImportance: {HIGH: 4},
  AuthorizationStatus: {DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2},
  TriggerType: {TIMESTAMP: 0},
}));
jest.mock('@himanshu8443/react-native-apk-installer', () => ({packageName: 'com.test'}));
jest.mock('../src/lib/storage', () => ({
  cacheStorage: {getString: () => undefined},
  settingsStorage: {getTmdbApiKey: () => ''},
  watchListStorage: {getWatchList: () => []},
}));
jest.mock('../src/lib/profiles/profiles', () => ({isKidsProfileActive: () => false}));
jest.mock('../src/lib/zustand/continueWatchingStore', () => ({__esModule: true, default: {getState: () => ({items: []})}}));

import {readAlertSettings, setAlertsEnabled, setShowAlert, syncAlerts} from '../src/lib/calendar/service';
import type {CalendarEpisode} from '../src/lib/calendar/types';

const mockNotifee = (jest.requireMock('@notifee/react-native') as {default: Record<string, jest.Mock<any>>}).default;

const soon = Date.now() + 2 * 60 * 60 * 1000;
const episode = (showKey: string): CalendarEpisode => ({
  id: `${showKey}:1:2`,
  showKey,
  showTitle: showKey,
  season: 1,
  episode: 2,
  airsAt: soon,
  timeKnown: true,
  source: 'tvmaze',
  open: {kind: 'info', link: 'l', provider: 'p'},
});
const calendar = {
  episodes: [episode('tt1'), episode('tt2')],
  shows: [
    {key: 'tt1', title: 'tt1', inWatchList: true, fromContinueWatching: false, fromTrakt: false},
    {key: 'tt2', title: 'tt2', inWatchList: false, fromContinueWatching: true, fromTrakt: false},
  ],
};

describe('new-episode alerts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is off by default and schedules nothing', async () => {
    expect(readAlertSettings().enabled).toBe(false);
    mockNotifee.getTriggerNotificationIds.mockResolvedValueOnce(['newep-x-1-1', 'livetv-1']);
    expect(await syncAlerts(calendar)).toBe(0);
    expect(mockNotifee.cancelTriggerNotification).toHaveBeenCalledWith('newep-x-1-1');
    expect(mockNotifee.cancelTriggerNotification).not.toHaveBeenCalledWith('livetv-1');
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();
  });

  it('stays off when permission is refused', async () => {
    mockNotifee.requestPermission.mockResolvedValueOnce({authorizationStatus: 0});
    expect(await setAlertsEnabled(true)).toBe(false);
    expect(readAlertSettings().enabled).toBe(false);
  });

  it('asks for permission when turned on, then schedules watch list shows only', async () => {
    expect(await setAlertsEnabled(true)).toBe(true);
    expect(mockNotifee.requestPermission).toHaveBeenCalledTimes(1);
    mockNotifee.getNotificationSettings.mockResolvedValue({authorizationStatus: 1});
    mockNotifee.createTriggerNotification.mockClear();
    expect(await syncAlerts(calendar)).toBe(1);
    const [notification, trigger] = mockNotifee.createTriggerNotification.mock.calls[0] as unknown as [any, any];
    expect(notification.title).toBe('New episode: tt1 S01E02');
    expect(notification.data).toEqual({navigationTarget: 'calendar'});
    expect(trigger.timestamp).toBe(soon);
  });

  it('follows per-show mutes', async () => {
    setShowAlert('tt1', false);
    setShowAlert('tt2', true);
    mockNotifee.createTriggerNotification.mockClear();
    expect(await syncAlerts(calendar)).toBe(1);
    expect((mockNotifee.createTriggerNotification.mock.calls.at(-1) as unknown as [any])[0].title).toContain('tt2');
  });
});

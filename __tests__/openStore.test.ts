import {afterEach, expect, it, jest} from '@jest/globals';

const mockFailures = new Map<string, number>();
jest.mock('react-native-mmkv-storage', () => {
  const actual = jest.requireActual<any>('../__mocks__/react-native-mmkv-storage.js');
  class FailingLoader extends actual.MMKVLoader {
    initialize() {
      const left = mockFailures.get(this.id) ?? 0;
      if (left > 0) {
        mockFailures.set(this.id, left - 1);
        throw new actual.InitializationError(this.id);
      }
      return super.initialize();
    }
  }
  return {...actual, MMKVLoader: FailingLoader};
});

import {openStore} from '../src/lib/storage/openStore';

afterEach(() => {
  mockFailures.clear();
  jest.restoreAllMocks();
});

it('opens the native store when it initializes', () => {
  const store = openStore('plain-ok');
  store.setString('a', '1');
  expect(openStore('plain-ok').getString('a')).toBe('1');
});

it('retries once after an InitializationError', () => {
  mockFailures.set('plain-retry', 1);
  openStore('plain-retry').setString('a', '1');
  expect(openStore('plain-retry').getString('a')).toBe('1');
});

it('falls back to a memory store instead of failing at import', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockFailures.set('plain-broken', 2);
  const store = openStore('plain-broken');
  expect(store.getString('missing')).toBeUndefined();
  store.setString('k', 'v');
  store.setArray('list', [1, 2]);
  expect(store.getString('k')).toBe('v');
  expect(store.getArray('list')).toEqual([1, 2]);
  store.removeItem('k');
  expect(store.getString('k')).toBeUndefined();
  expect(console.error).toHaveBeenCalled();
});

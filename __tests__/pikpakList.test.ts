const mockFetch = jest.fn();
jest.mock('../src/lib/debrid/http', () => ({
  debridFetch: (...args: unknown[]) => mockFetch(...args),
  DebridHttpError: class DebridHttpError extends Error {},
}));
jest.mock('../src/lib/sources/vault', () => ({readPikPakAccount: () => undefined}));

import {pikpak} from '../src/lib/debrid/more';

describe('PikPak file list', () => {
  beforeEach(() => mockFetch.mockReset());

  it('lists top-level files and the contents of the download folder', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('parent_id=pack')) {
        return Promise.resolve({files: [{id: 'f2', kind: 'drive#folder', name: 'Season 1'}]});
      }
      return Promise.resolve({files: [
        {id: 'f1', kind: 'drive#file', name: 'movie.mp4', size: '1000'},
        {id: 'pack', kind: 'drive#folder', name: 'My Pack', folder_type: 'DOWNLOAD'},
      ]});
    });
    const items = await pikpak.list!('token');
    expect(items.map(item => item.name)).toEqual(['movie.mp4', 'Season 1']);
    expect(items[0]).toMatchObject({id: '|f1', ready: true, files: [{id: 'f1', size: 1000}]});
    expect(items[1].files).toEqual([]);
  });

  it('reads a listed folder without asking for a task', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/tasks/')) throw new Error('should not ask for a task');
      if (url.includes('/files/f2')) return Promise.resolve({id: 'f2', kind: 'drive#folder', name: 'Season 1'});
      return Promise.resolve({files: [{id: 'e1', kind: 'drive#file', name: 'e1.mkv', size: '5'}]});
    });
    const transfer = await pikpak.status('token', '|f2');
    expect(transfer).toMatchObject({ready: true, files: [{id: 'e1', name: 'e1.mkv'}]});
  });
});

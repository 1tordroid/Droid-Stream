import {archiveDirectVideo, archiveFileUrl, archiveItemId, pickArchiveVideo} from '../src/lib/torrentSearch/archive';

const TORRENT = 'https://archive.org/download/BigBuckBunny_328/BigBuckBunny_328_archive.torrent';

describe('Internet Archive direct playback', () => {
  it('finds the item only in archive torrent links', () => {
    expect(archiveItemId(TORRENT)).toBe('BigBuckBunny_328');
    expect(archiveItemId('https://example.test/file.torrent')).toBeUndefined();
    expect(archiveItemId(undefined)).toBeUndefined();
  });

  it('prefers MP4 even when another format is larger', () => {
    const file = pickArchiveVideo([
      {name: 'movie.avi', size: '400'},
      {name: 'movie.ogv', size: '48'},
      {name: 'movie_512kb.mp4', size: '43'},
      {name: 'meta.xml', size: '1'},
    ]);
    expect(file?.name).toBe('movie_512kb.mp4');
  });

  it('skips samples and non-video files', () => {
    expect(pickArchiveVideo([{name: 'sample.mp4'}, {name: 'poster.jpg'}])).toBeUndefined();
  });

  it('encodes file names but keeps folders', () => {
    expect(archiveFileUrl('item', 'folder/my movie.mp4')).toBe('https://archive.org/download/item/folder/my%20movie.mp4');
  });

  it('falls back when the lookup fails', async () => {
    const original = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as any;
    await expect(archiveDirectVideo(TORRENT)).resolves.toBeUndefined();
    global.fetch = jest.fn().mockResolvedValue({ok: true, json: async () => ({result: [{name: 'a.mp4'}]})}) as any;
    await expect(archiveDirectVideo(TORRENT)).resolves.toEqual({url: 'https://archive.org/download/BigBuckBunny_328/a.mp4', name: 'a.mp4'});
    global.fetch = original;
  });
});

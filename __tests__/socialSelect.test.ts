jest.mock('../src/lib/downloadManager', () => ({scheduleQueuedDownloads: jest.fn(async () => undefined)}));
jest.mock('../src/lib/downloadLocation', () => ({
  ensureDownloadLocationAccess: async (location: unknown) => location,
  getDownloadFileName: (name: string, type: string) => `${name}.${type}`,
}));

import {describe, expect, it} from '@jest/globals';
import {getDownloadDirectoryNames} from '../src/lib/downloadId';
import {authorFolder, itemFileName, socialFolderPath, songFileName, songVideoFileName} from '../src/lib/social/paths';
import {buildSocialRecords, itemLabel} from '../src/lib/social/queue';
import {chosenItems, defaultSelection, pickVariant, planCount, planDownloads, toggleItem, visibleItems} from '../src/lib/social/select';
import type {SocialMediaItem, SocialPost} from '../src/lib/social/types';
import type {DownloadItem} from '../src/lib/zustand/downloadsStore';

const image = (id: string, index: number, postId = 'C3xYzAbCdEf'): SocialMediaItem => ({
  id,
  kind: 'image',
  variants: [
    {url: `https://cdn.test/${id}_1440.jpg`, width: 1440, height: 1800},
    {url: `https://cdn.test/${id}_1080.jpg`, width: 1080, height: 1350},
    {url: `https://cdn.test/${id}_640.jpg`, width: 640, height: 800},
  ],
  thumbnail: `https://cdn.test/${id}_320.jpg`,
  ext: 'jpg',
  postId,
  index,
});

const video = (id: string, index: number, extra: Partial<SocialMediaItem> = {}): SocialMediaItem => ({
  id,
  kind: 'video',
  variants: [{url: `https://cdn.test/${id}.mp4`, width: 1080, height: 1350}],
  thumbnail: `https://cdn.test/${id}.jpg`,
  ext: 'mp4',
  postId: 'C3xYzAbCdEf',
  index,
  ...extra,
});

const post: SocialPost = {
  site: 'instagram',
  kind: 'post',
  url: 'https://www.instagram.com/p/C3xYzAbCdEf/',
  author: 'sample.user',
  title: 'Weekend',
  items: [image('a', 1), video('b', 2), image('c', 3)],
  music: {url: 'https://cdn.test/song.mp4', title: 'Ocean Song', artist: 'The Band', start: 45, clip: 15},
};

const all = new Set(post.items.map(item => item.id));

describe('selection', () => {
  it('picks the size for each quality', () => {
    expect(pickVariant(post.items[0], 'original')?.width).toBe(1440);
    expect(pickVariant(post.items[0], 'large')?.width).toBe(1080);
    expect(pickVariant(post.items[0], 'medium')?.width).toBe(640);
    // Sizes with no width (an "orig" link) count as the original.
    expect(pickVariant({...post.items[0], variants: [{url: 'x'}]}, 'medium')?.url).toBe('x');
  });

  it('hides videos with "Photos only" and keeps post order', () => {
    expect(visibleItems(post.items, true).map(item => item.id)).toEqual(['a', 'c']);
    expect(chosenItems(post.items, new Set(['c', 'a', 'b']), true).map(item => item.id)).toEqual(['a', 'c']);
    expect(chosenItems(post.items, new Set(['b']), false).map(item => item.id)).toEqual(['b']);
    expect([...toggleItem(new Set(['a']), 'a')]).toEqual([]);
    expect([...toggleItem(new Set(['a']), 'b')]).toEqual(['a', 'b']);
  });

  it('selects everything, except the profile picture in a profile batch', () => {
    expect(defaultSelection(post)).toEqual(all);
    const profile: SocialPost = {...post, kind: 'profile', items: [image('pic', 1, 'profile'), image('p1', 1, 'P1')]};
    expect([...defaultSelection(profile)]).toEqual(['p1']);
    expect([...defaultSelection({...profile, items: [profile.items[0]]})]).toEqual(['pic']);
  });

  it('plans photos, the song and the photo-with-song video', () => {
    const photo = planDownloads(post, all, {photosOnly: false, quality: 'original', music: {photo: true, song: false, video: false}});
    expect(photo.files.map(file => file.variant.url)).toEqual(['https://cdn.test/a_1440.jpg', 'https://cdn.test/b.mp4', 'https://cdn.test/c_1440.jpg']);
    expect(planCount(photo)).toBe(3);

    const songOnly = planDownloads(post, all, {photosOnly: true, quality: 'original', music: {photo: false, song: true, video: false}});
    expect(songOnly.files).toEqual([]);
    expect(songOnly.song).toBe(true);
    expect(planCount(songOnly)).toBe(1);

    const withVideo = planDownloads(post, all, {photosOnly: true, quality: 'original', music: {photo: false, song: false, video: true}});
    // The slideshow uses photos no larger than 1080 px.
    expect(withVideo.videoImages.map(file => file.variant.url)).toEqual(['https://cdn.test/a_1080.jpg', 'https://cdn.test/c_1080.jpg']);
    expect(planCount(withVideo)).toBe(1);
  });

  it('sends videos with no file link to the video downloader', () => {
    const page = {...post, music: undefined, items: [image('a', 1), video('v', 2, {variants: [], needsYtdl: true, pageUrl: 'https://x.test/p'})]};
    const plan = planDownloads(page, new Set(['a', 'v']), {photosOnly: false, quality: 'large'});
    expect(plan.files.map(file => file.item.id)).toEqual(['a']);
    expect(plan.ytdl.map(item => item.pageUrl)).toEqual(['https://x.test/p']);
  });
});

describe('paths', () => {
  it('saves under Social/<site>/<author>', () => {
    expect(socialFolderPath(post)).toEqual(['Social', 'Instagram', 'sample.user']);
    expect(socialFolderPath({site: 'twitter', author: '@Some/Name'})).toEqual(['Social', 'X', 'Some Name']);
    expect(authorFolder('', 'reddit')).toBe('Reddit');
    expect(getDownloadDirectoryNames({showName: 'Social', title: 'x', seasonTitle: 'Instagram', subFolder: 'sample.user'})).toEqual(['Social', 'Instagram', 'sample.user']);
    expect(getDownloadDirectoryNames({title: 'Movie'})).toEqual(['Movie']);
  });

  it('names files after the author, the post and the slide', () => {
    expect(post.items.map(item => itemFileName(post, item))).toEqual(['sample.user_C3xYzAbCdEf_1', 'sample.user_C3xYzAbCdEf_2', 'sample.user_C3xYzAbCdEf_3']);
    const single = {...post, items: [image('a', 1)]};
    expect(itemFileName(single, single.items[0])).toBe('sample.user_C3xYzAbCdEf');
    const reel = {...post, items: [video('v', 1), {...image('v-cover', 1)}]};
    expect(reel.items.map(item => itemFileName(reel, item))).toEqual(['sample.user_C3xYzAbCdEf_video', 'sample.user_C3xYzAbCdEf_cover']);
    expect(itemFileName(post, image('p', 1, 'profile'))).toBe('sample.user_profile_picture');
    expect(songFileName(post)).toBe('sample.user_C3xYzAbCdEf_The Band - Ocean Song');
    expect(songVideoFileName(post)).toBe('sample.user_C3xYzAbCdEf_with_song');
    expect(itemLabel(post, post.items[0])).toBe('Photo 1');
    expect(itemLabel(post, post.items[1])).toBe('Video');
  });
});

describe('download records', () => {
  let counter = 0;
  const makeId = () => `id${++counter}`;
  const options = {quality: 'original' as const, secondsPerImage: 3, crossfade: true};

  it('makes file downloads with headers, a song file and one video job', () => {
    const plan = planDownloads(post, all, {photosOnly: true, quality: 'original', music: {photo: true, song: true, video: true}});
    const {records, duplicates} = buildSocialRecords(post, plan, options, [], makeId);
    expect(duplicates).toBe(0);
    expect(records.map(record => [record.sourceType, record.displayFileName])).toEqual([
      ['http', 'sample.user_C3xYzAbCdEf_1.jpg'],
      ['http', 'sample.user_C3xYzAbCdEf_3.jpg'],
      ['http', 'sample.user_C3xYzAbCdEf_The Band - Ocean Song.m4a'],
      ['social', 'sample.user_C3xYzAbCdEf_with_song.mp4'],
    ]);
    expect(records[0]).toMatchObject({showName: 'Social', seasonTitle: 'Instagram', subFolder: 'sample.user', videoType: 'jpg', status: 'queued', title: 'sample.user · Photo 1'});
    expect(records[0].headers?.Referer).toBe('https://www.instagram.com/');
    expect(records[3].social).toEqual({
      images: [
        {url: 'https://cdn.test/a_1080.jpg', ext: 'jpg'},
        {url: 'https://cdn.test/c_1080.jpg', ext: 'jpg'},
      ],
      audioUrl: 'https://cdn.test/song.mp4',
      headers: records[0].headers,
      start: 45,
      duration: 15,
      secondsPerImage: 3,
      crossfade: true,
      width: 1080,
      height: 1350,
    });
  });

  it('skips files that are already in the queue', () => {
    const plan = planDownloads(post, new Set(['a']), {photosOnly: false, quality: 'original'});
    const existing = [{url: 'https://cdn.test/a_1440.jpg', sourceType: 'http', status: 'downloading'} as DownloadItem];
    expect(buildSocialRecords(post, plan, options, existing, makeId)).toEqual({records: [], duplicates: 1});
    const done = [{...existing[0], status: 'completed'} as DownloadItem];
    expect(buildSocialRecords(post, plan, options, done, makeId).records).toHaveLength(1);
  });
});

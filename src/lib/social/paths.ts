import {sanitizeDownloadFileName} from '../downloadId';
import {SITE_LABELS} from './urls';
import type {SocialMediaItem, SocialPost, SocialSite} from './types';

/** The top folder for every social download. */
export const SOCIAL_FOLDER = 'Social';

/** "@Some.User " -> "Some.User"; never empty. */
export const authorFolder = (author: string | undefined, site: SocialSite): string => {
  const clean = sanitizeDownloadFileName((author || '').replace(/^@+/, '').trim());
  return clean && clean !== 'download' ? clean : SITE_LABELS[site];
};

/** <download location>/Social/<site>/<author>/ as download record fields. */
export const socialFolders = (post: Pick<SocialPost, 'site' | 'author'>) => ({
  showName: SOCIAL_FOLDER,
  seasonTitle: SITE_LABELS[post.site],
  subFolder: authorFolder(post.author, post.site),
});

/** Folder names in order, as the download manager creates them. */
export const socialFolderPath = (post: Pick<SocialPost, 'site' | 'author'>): string[] => {
  const folders = socialFolders(post);
  return [folders.showName, folders.seasonTitle, folders.subFolder];
};

const postItemCount = (post: SocialPost, postId: string) => post.items.filter(item => item.postId === postId).length;

/**
 * File name without extension: "author_POSTID" for a single photo,
 * "author_POSTID_2" inside a carousel, "author_POSTID_2_video" when a slide
 * has both a video and its cover.
 */
export const itemFileName = (post: SocialPost, item: SocialMediaItem): string => {
  const author = authorFolder(post.author, post.site);
  if (item.postId === 'profile') return sanitizeDownloadFileName(`${author}_profile_picture`);
  const parts = [author, item.postId];
  const siblings = post.items.filter(other => other.postId === item.postId && other.index === item.index);
  if (postItemCount(post, item.postId) > siblings.length || item.index > 1) parts.push(String(item.index));
  if (siblings.length > 1) parts.push(item.kind === 'video' ? 'video' : 'cover');
  return sanitizeDownloadFileName(parts.join('_'));
};

const mainPostId = (post: SocialPost): string => post.items.find(item => item.postId !== 'profile')?.postId || 'post';

export const songFileName = (post: SocialPost): string => {
  const author = authorFolder(post.author, post.site);
  const song = [post.music?.artist, post.music?.title].filter(Boolean).join(' - ');
  return sanitizeDownloadFileName(song ? `${author}_${mainPostId(post)}_${song}` : `${author}_${mainPostId(post)}_song`);
};

export const songVideoFileName = (post: SocialPost): string =>
  sanitizeDownloadFileName(`${authorFolder(post.author, post.site)}_${mainPostId(post)}_with_song`);

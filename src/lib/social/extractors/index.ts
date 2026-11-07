import type {SocialExtractor, SocialSite} from '../types';
import {facebookExtractor} from './facebook';
import {instagramExtractor} from './instagram';
import {pinterestExtractor} from './pinterest';
import {redditExtractor} from './reddit';
import {threadsExtractor} from './threads';
import {tumblrExtractor} from './tumblr';
import {twitterExtractor} from './twitter';

export const EXTRACTORS: Record<SocialSite, SocialExtractor> = {
  instagram: instagramExtractor,
  facebook: facebookExtractor,
  twitter: twitterExtractor,
  threads: threadsExtractor,
  pinterest: pinterestExtractor,
  reddit: redditExtractor,
  tumblr: tumblrExtractor,
};

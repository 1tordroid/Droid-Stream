import {openStore} from './storage/openStore';

export const MMKV = openStore();
export const MmmkvCache = openStore('cache');

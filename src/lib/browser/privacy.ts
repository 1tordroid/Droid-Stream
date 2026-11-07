import {clearSiteCookies} from '../services/cookieManager';
import {clearOrigins} from './native';
import {readPendingPrivateHosts, savePendingPrivateHosts} from './store';

/**
 * Private tabs. Android's WebView has one cookie and storage jar for the
 * whole app, so a private tab cannot have a separate one. Instead the
 * browser saves no history, passwords or tabs for it, and when it closes,
 * deletes the cookies and site data of every site it visited. Those sites'
 * cookies from normal tabs go too, so a sign-in there ends as well.
 */

export const rememberPrivateHost = (host: string): void => {
  if (!host) return;
  const pending = readPendingPrivateHosts();
  if (!pending.includes(host)) savePendingPrivateHosts([...pending, host]);
};

/** Clears what private tabs left for these hosts, or for every host still pending. */
export const clearPrivateData = async (hosts: string[] = readPendingPrivateHosts()): Promise<void> => {
  if (!hosts.length) return;
  for (const host of hosts) {
    for (const scheme of ['https', 'http']) {
      await clearSiteCookies(`${scheme}://${host}/`).catch(() => undefined);
    }
  }
  await clearOrigins(hosts.flatMap(host => [`https://${host}`, `http://${host}`]));
  savePendingPrivateHosts(readPendingPrivateHosts().filter(host => !hosts.includes(host)));
};

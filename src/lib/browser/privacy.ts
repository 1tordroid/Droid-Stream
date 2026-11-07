import {browserEngine} from './engine';
import {readPendingPrivateHosts, savePendingPrivateHosts} from './store';

/**
 * Private tabs. Android's WebView (the engine of this build) has one
 * cookie and storage jar for the whole app, so a private tab cannot have
 * a separate one. Instead the
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
      await browserEngine().cookies.clearSite(`${scheme}://${host}/`).catch(() => undefined);
    }
  }
  await browserEngine().clearSiteData(hosts.flatMap(host => [`https://${host}`, `http://${host}`])).catch(() => undefined);
  savePendingPrivateHosts(readPendingPrivateHosts().filter(host => !hosts.includes(host)));
};

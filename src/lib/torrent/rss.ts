export interface RssItem {
  title: string;
  link: string;
}

/** Pulls magnet links and .torrent enclosures out of an RSS or Atom feed. */
export const parseFeedLinks = (xml: string): RssItem[] => {
  const items: RssItem[] = [];
  const chunks = xml.split(/<item\b|<entry\b/i).slice(1);
  for (const chunk of chunks) {
    const title = decode(chunk.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || 'Feed item');
    const magnet = chunk.match(/magnet:\?[^<"'\s]+/i)?.[0];
    const enclosure = chunk.match(/<enclosure\b[^>]*url=["']([^"']+)["']/i)?.[1];
    const link = chunk.match(/<link[^>]*>([^<]*\.torrent[^<]*)<\/link>/i)?.[1]
      || chunk.match(/<link[^>]*href=["']([^"']+\.torrent[^"']*)["']/i)?.[1];
    const href = magnet || enclosure || link;
    if (href && /^(magnet:|https?:)/i.test(href)) items.push({title: title.trim(), link: href.trim()});
  }
  return items;
};

const decode = (value: string): string =>
  value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

export const feedItemMatches = (title: string, keywords: string): boolean => {
  const words = keywords.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = title.toLowerCase();
  return words.every(word => haystack.includes(word));
};

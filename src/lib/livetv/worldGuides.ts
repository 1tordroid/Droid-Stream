/**
 * Automatic TV guide for World countries (and Free Indian channels). Pure:
 * no React Native imports.
 *
 * iptv-org's country playlists carry no guide address, and iptv-org/epg
 * publishes only the tools to build guides, not guide files. These two free
 * sites publish ready-made XMLTV files per country, updated daily:
 *   - open-epg.com: https://www.open-epg.com/files/<name>.xml.gz
 *   - epgshare01.online: https://epgshare01.online/epgshare01/epg_ripper_<name>.xml.gz
 * Their channel ids are not iptv-org's tvg-ids, so channels are matched by
 * name and by the id read as a name (see channelNameKeys in xmltv.ts).
 *
 * For each country the file that matched the most of its iptv-org channels
 * with programmes on the day of the survey is first. A second file is listed
 * only where it adds at least 8% of the channels (and 5 or more). Countries
 * not here have no free guide that matches; the guide says so.
 * See docs/DEVELOPMENT.md ("World TV guide") for how to redo the survey.
 */
import {INDIA, normalizeCountryCode} from './countries';

export type GuideSite = 'open-epg' | 'epgshare01';

export interface CountryGuideFile {
  url: string;
  site: GuideSite;
  /** Download size (gzipped), in KB. */
  gzKB: number;
  /** Size once unzipped, in MB: what the parser reads. */
  xmlMB: number;
}

/** Shown when a country has no automatic guide (and no address of its own). */
export const NO_COUNTRY_GUIDE = 'No guide available for this country.';

/** Largest download for an automatic guide; files listed here are well under it. */
export const AUTO_GUIDE_MAX_BYTES = 8 * 1024 * 1024;
/** On a device with 2 GB of RAM or less, only one file, and none over this size unzipped. */
export const LOW_MEMORY_XML_MB = 20;
export const LOW_MEMORY_RAM_MB = 2048;

// "CODE site:name:gzKB:xmlMB ...|", best file first. o = open-epg, e = epgshare01.
// Survey of 7 November 2026 (iptv-org country playlists against both sites).
const DATA =
  'AL o:albania:218:2|AR o:argentina:628:5|AT o:austria:551:4|AU o:australia:1159:9|BA e:BA1:2314:22|' +
  'BE o:belgium:1505:9|BG o:bulgaria2:1098:9 o:bulgaria4:203:4|BO o:bolivia:299:3|BR o:brazil:1573:11|' +
  'CA o:canada:2332:16|CH o:switzerland3:975:16|CI o:ivorycoast1:457:7|CL o:chile2:514:4|CN o:china3:23:1|' +
  'CO o:colombia1:432:3|CY o:cyprus2:100:2|CZ e:CZ1:6177:36 o:czech1:509:3|DE o:germany:2592:15|' +
  'DK e:DK1:1332:10|EE o:estonia1:147:2|EG o:egypt2:144:2|ES o:spain:1255:8|FI o:finland:566:4|' +
  'FR o:france:2287:15|GB o:unitedkingdom:1219:9|GE o:georgia2:95:2|GR o:greece:818:7|GT o:guatemala:427:3|' +
  'HK o:hongkong3:137:2|HN o:honduras:403:3|HR o:croatia:1089:9|HU o:hungary1:639:4|ID o:indonesia:295:3|' +
  'IE o:ireland:650:4|IL o:israel:821:7|IN o:india:1527:20|IT e:IT1:1692:13|KE o:kenya1:196:2|' +
  'KR o:korea1:217:3|LT o:lithuania:1105:9|LU e:LU1:4150:22|LV e:LV1:767:6|MD o:moldova:16:1|' +
  'MK o:macedonia1:330:5|MN o:mongolia1:21:1|MT e:MT1:1245:11|MX o:mexico2:107:2|MY o:malaysia3:324:2|' +
  'NL o:netherlands:363:4|NO o:norway:619:4|NZ o:newzealand:220:2|PE o:peru:506:4|PH e:PH2:201:2|' +
  'PL o:poland:3127:18|PT o:portugal:948:6|PY o:paraguay2:202:2|RO o:romania:665:6|RS o:serbia1:1479:12|' +
  'SE o:sweden1:921:5|SG o:singapore2:78:1|SI o:slovenia:1090:8|SK o:slovakia1:337:4 o:slovakia3:1055:6|' +
  'SV o:elsalvador1:256:2|TH o:thailand2:56:1|TR e:TR3:1702:19|UA o:ukraine:32:1|' +
  'US o:unitedstates9:873:6 o:unitedstates7:605:4|UY o:uruguay:833:5|UZ o:uzbekistan1:1059:9|' +
  'VE o:venezuela1:117:2|VN e:VN1:219:3|ZA e:ZA1:170:3|';

const fileUrl = (site: GuideSite, name: string) =>
  site === 'open-epg' ? `https://www.open-epg.com/files/${name}.xml.gz` : `https://epgshare01.online/epgshare01/epg_ripper_${name}.xml.gz`;

const TABLE = new Map<string, CountryGuideFile[]>(
  DATA.split('|')
    .filter(Boolean)
    .map(entry => {
      const [code, ...files] = entry.split(' ');
      return [
        code,
        files.map(file => {
          const [letter, name, gzKB, xmlMB] = file.split(':');
          const site: GuideSite = letter === 'o' ? 'open-epg' : 'epgshare01';
          return {url: fileUrl(site, name), site, gzKB: Number(gzKB), xmlMB: Number(xmlMB)};
        }),
      ];
    }),
);

/** Countries that have an automatic guide. */
export const countriesWithGuide = (): string[] => [...TABLE.keys()];

/**
 * The guide files for a country, best first. With little memory, only the
 * first file small enough to read.
 */
export const countryGuideFiles = (code: string | undefined, {lowMemory = false}: {lowMemory?: boolean} = {}): CountryGuideFile[] => {
  const clean = normalizeCountryCode(code);
  const files = (clean && TABLE.get(clean)) || [];
  if (!lowMemory) return files;
  const small = files.find(file => file.xmlMB <= LOW_MEMORY_XML_MB);
  return small ? [small] : [];
};

/** Whether the device counts as low on memory for guides (2 GB of RAM or less). */
export const isLowMemoryRam = (totalRamMB: number) => totalRamMB > 0 && totalRamMB <= LOW_MEMORY_RAM_MB;

/**
 * The country whose automatic guide a source uses: India for Free Indian
 * channels, the country of a World source, and for All countries the
 * country picked in the filters (no guide until one is picked).
 */
export const autoGuideCountry = (sourceId: string, pickedCountry?: string): string | undefined => {
  if (sourceId === 'iptv-org') return INDIA;
  if (sourceId === 'world:all') return normalizeCountryCode(pickedCountry);
  if (sourceId.startsWith('world:')) return normalizeCountryCode(sourceId.slice(6));
  return undefined;
};

/** The automatic guide addresses for a source (empty when there is none). */
export const autoGuideUrls = (sourceId: string, options: {country?: string; lowMemory?: boolean} = {}): string[] =>
  countryGuideFiles(autoGuideCountry(sourceId, options.country), options).map(file => file.url);

/** Which site an address belongs to, for the credit line under the guide. */
export const guideSiteOf = (url: string | undefined): GuideSite | undefined =>
  !url ? undefined : url.startsWith('https://www.open-epg.com/') ? 'open-epg' : url.startsWith('https://epgshare01.online/') ? 'epgshare01' : undefined;

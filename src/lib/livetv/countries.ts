/**
 * Countries for the World source in Live TV. Pure: no React Native imports.
 *
 * The list is kept in the app (taken from iptv-org's countries.json) so the
 * country picker works offline. Codes are ISO 3166-1 alpha-2 as Android
 * reports them; iptv-org files the United Kingdom under "uk", not "gb".
 */

export interface Country {
  /** Upper-case ISO 3166-1 alpha-2 code ("GB"). */
  code: string;
  name: string;
}

// "CODE:Name|" pairs, sorted by name.
const DATA =
  'AF:Afghanistan|AX:Aland|AL:Albania|DZ:Algeria|AS:American Samoa|AD:Andorra|AO:Angola|AI:Anguilla|AQ:Antarctica|' +
  'AG:Antigua and Barbuda|AR:Argentina|AM:Armenia|AW:Aruba|AU:Australia|AT:Austria|AZ:Azerbaijan|BS:Bahamas|' +
  'BH:Bahrain|BD:Bangladesh|BB:Barbados|BY:Belarus|BE:Belgium|BZ:Belize|BJ:Benin|BM:Bermuda|BT:Bhutan|BO:Bolivia|' +
  'BQ:Bonaire|BA:Bosnia and Herzegovina|BW:Botswana|BV:Bouvet Island|BR:Brazil|IO:British Indian Ocean Territory|' +
  'VG:British Virgin Islands|BN:Brunei|BG:Bulgaria|BF:Burkina Faso|BI:Burundi|KH:Cambodia|CM:Cameroon|CA:Canada|' +
  'CV:Cape Verde|KY:Cayman Islands|CF:Central African Republic|TD:Chad|CL:Chile|CN:China|CX:Christmas Island|' +
  'CC:Cocos (Keeling) Islands|CO:Colombia|KM:Comoros|CK:Cook Islands|CR:Costa Rica|HR:Croatia|CU:Cuba|CW:Curacao|' +
  'CY:Cyprus|CZ:Czech Republic|CD:Democratic Republic of the Congo|DK:Denmark|DJ:Djibouti|DM:Dominica|' +
  'DO:Dominican Republic|TL:East Timor|EC:Ecuador|EG:Egypt|SV:El Salvador|GQ:Equatorial Guinea|ER:Eritrea|' +
  'EE:Estonia|ET:Ethiopia|FK:Falkland Islands|FO:Faroe Islands|FJ:Fiji|FI:Finland|FR:France|GF:French Guiana|' +
  'PF:French Polynesia|TF:French Southern Territories|GA:Gabon|GM:Gambia|GE:Georgia|DE:Germany|GH:Ghana|' +
  'GI:Gibraltar|GR:Greece|GL:Greenland|GD:Grenada|GP:Guadeloupe|GU:Guam|GT:Guatemala|GG:Guernsey|GN:Guinea|' +
  'GW:Guinea-Bissau|GY:Guyana|HT:Haiti|HM:Heard Island and McDonald Islands|HN:Honduras|HK:Hong Kong|HU:Hungary|' +
  'IS:Iceland|IN:India|ID:Indonesia|IR:Iran|IQ:Iraq|IE:Ireland|IM:Isle of Man|IL:Israel|IT:Italy|CI:Ivory Coast|' +
  'JM:Jamaica|JP:Japan|JE:Jersey|JO:Jordan|KZ:Kazakhstan|KE:Kenya|KI:Kiribati|XK:Kosovo|KW:Kuwait|KG:Kyrgyzstan|' +
  'LA:Laos|LV:Latvia|LB:Lebanon|LS:Lesotho|LR:Liberia|LY:Libya|LI:Liechtenstein|LT:Lithuania|LU:Luxembourg|' +
  'MO:Macao|MG:Madagascar|MW:Malawi|MY:Malaysia|MV:Maldives|ML:Mali|MT:Malta|MH:Marshall Islands|MQ:Martinique|' +
  'MR:Mauritania|MU:Mauritius|YT:Mayotte|MX:Mexico|FM:Micronesia|MD:Moldova|MC:Monaco|MN:Mongolia|ME:Montenegro|' +
  'MS:Montserrat|MA:Morocco|MZ:Mozambique|MM:Myanmar|NA:Namibia|NR:Nauru|NP:Nepal|NL:Netherlands|NC:New Caledonia|' +
  'NZ:New Zealand|NI:Nicaragua|NE:Niger|NG:Nigeria|NU:Niue|NF:Norfolk Island|KP:North Korea|MK:North Macedonia|' +
  'MP:Northern Mariana Islands|NO:Norway|OM:Oman|PK:Pakistan|PW:Palau|PS:Palestine|PA:Panama|PG:Papua New Guinea|' +
  'PY:Paraguay|PE:Peru|PH:Philippines|PN:Pitcairn Islands|PL:Poland|PT:Portugal|PR:Puerto Rico|QA:Qatar|' +
  'CG:Republic of the Congo|RE:Reunion|RO:Romania|RU:Russia|RW:Rwanda|BL:Saint Barthélemy|SH:Saint Helena|' +
  'KN:Saint Kitts and Nevis|LC:Saint Lucia|MF:Saint Martin|PM:Saint Pierre and Miquelon|' +
  'VC:Saint Vincent and the Grenadines|WS:Samoa|SM:San Marino|ST:Sao Tome and Principe|SA:Saudi Arabia|SN:Senegal|' +
  'RS:Serbia|SC:Seychelles|SL:Sierra Leone|SG:Singapore|SX:Sint Maarten|SK:Slovakia|SI:Slovenia|' +
  'SB:Solomon Islands|SO:Somalia|ZA:South Africa|GS:South Georgia and the South Sandwich Islands|KR:South Korea|' +
  'SS:South Sudan|ES:Spain|LK:Sri Lanka|SD:Sudan|SR:Suriname|SJ:Svalbard and Jan Mayen|SZ:Swaziland|SE:Sweden|' +
  'CH:Switzerland|SY:Syria|TW:Taiwan|TJ:Tajikistan|TZ:Tanzania|TH:Thailand|TG:Togo|TK:Tokelau|TO:Tonga|' +
  'TT:Trinidad and Tobago|TN:Tunisia|TR:Turkiye|TM:Turkmenistan|TC:Turks and Caicos Islands|TV:Tuvalu|' +
  'UM:U.S. Minor Outlying Islands|VI:U.S. Virgin Islands|UG:Uganda|UA:Ukraine|AE:United Arab Emirates|' +
  'GB:United Kingdom|US:United States|UY:Uruguay|UZ:Uzbekistan|VU:Vanuatu|VA:Vatican City|VE:Venezuela|VN:Vietnam|' +
  'WF:Wallis and Futuna|EH:Western Sahara|YE:Yemen|ZM:Zambia|ZW:Zimbabwe|';

export const COUNTRIES: Country[] = DATA.split('|')
  .filter(Boolean)
  .map(item => ({code: item.slice(0, 2), name: item.slice(3)}));

const BY_CODE = new Map(COUNTRIES.map(country => [country.code, country]));

/** India has its own source (Free Indian channels), so World never shows it. */
export const INDIA = 'IN';

/** "gb", " GB " or "uk" as an upper-case code from the list, or undefined. */
export const normalizeCountryCode = (input: string | null | undefined): string | undefined => {
  let code = (input || '').trim().toUpperCase();
  if (code === 'UK') code = 'GB';
  return /^[A-Z]{2}$/.test(code) && BY_CODE.has(code) ? code : undefined;
};

export const findCountry = (code: string | null | undefined): Country | undefined => {
  const clean = normalizeCountryCode(code);
  return clean ? BY_CODE.get(clean) : undefined;
};

/** The flag emoji for a two-letter code (regional indicator letters). */
export const flagOf = (code: string): string =>
  /^[A-Za-z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code.toUpperCase()].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65))
    : '';

/** iptv-org's playlist for one country. */
export const worldPlaylistUrl = (code: string): string => {
  const clean = normalizeCountryCode(code) || code.toUpperCase();
  return `https://iptv-org.github.io/iptv/countries/${clean === 'GB' ? 'uk' : clean.toLowerCase()}.m3u`;
};

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * Countries for the picker: the detected one first, then recent picks, then
 * the rest by name. A search matches the code first, then names starting
 * with it, then names that have it anywhere.
 */
export const searchCountries = (
  query: string,
  {detected, recent = []}: {detected?: string; recent?: string[]} = {},
): Country[] => {
  const q = fold(query.trim());
  const codeMatch = q.length === 2 ? normalizeCountryCode(q) : undefined;
  // 0: the code, 1: the name starts with it, 2: the name has it, -1: no match.
  const rank = (country: Country) => {
    if (!q || country.code === codeMatch) return 0;
    const name = fold(country.name);
    return name.startsWith(q) ? 1 : name.includes(q) ? 2 : -1;
  };
  const pinned: Country[] = [];
  const seen = new Set<string>();
  for (const code of [detected, ...recent]) {
    const country = findCountry(code);
    if (country && !seen.has(country.code)) {
      seen.add(country.code);
      pinned.push(country);
    }
  }
  const rest = COUNTRIES.filter(country => !seen.has(country.code));
  return [...pinned, ...rest]
    .map(country => ({country, rank: rank(country)}))
    .filter(item => item.rank >= 0)
    .sort((x, y) => x.rank - y.rank)
    .map(item => item.country);
};

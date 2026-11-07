import {ed2kFileLink, ed2kLinksIn, isEd2kLink, parseEd2kLink} from '../src/lib/ed2k/link';

const HASH = '965c013e991ee246d63d45ea71954c4d';

describe('parseEd2kLink', () => {
  it('reads a file link', () => {
    expect(parseEd2kLink(`ed2k://|file|The_Two_Towers-Trailer.avi|14997504|${HASH}|/`)).toEqual({
      kind: 'file',
      name: 'The_Two_Towers-Trailer.avi',
      size: 14997504,
      hash: HASH,
      sources: [],
    });
  });

  it('decodes the name and lowercases the hash', () => {
    const link = parseEd2kLink(`ed2k://|file|My%20File%20%C3%A9.iso|100|${HASH.toUpperCase()}|/`);
    expect(link).toMatchObject({kind: 'file', name: 'My File é.iso', hash: HASH});
  });

  it('reads AICH, part hashes and sources', () => {
    const part = 'a'.repeat(32);
    const link = parseEd2kLink(
      `ed2k://|file|a.bin|20000000|${HASH}|h=H52BRVWPBBTAED5NXQDH2RJDDAKRUWST|p=${part}:${'B'.repeat(32)}|/|sources,202.89.123.6:4662,host.example:4242,bad,1.2.3.4:99999|/`,
    );
    expect(link).toEqual({
      kind: 'file',
      name: 'a.bin',
      size: 20000000,
      hash: HASH,
      aich: 'H52BRVWPBBTAED5NXQDH2RJDDAKRUWST',
      partHashes: [part, 'b'.repeat(32)],
      sources: ['202.89.123.6:4662', 'host.example:4242'],
    });
  });

  it('accepts percent-encoded separators from browsers', () => {
    expect(parseEd2kLink(`ed2k://%7Cfile%7Cx.iso%7C5%7C${HASH}%7C/`)).toMatchObject({kind: 'file', name: 'x.iso', size: 5});
  });

  it('reads server and server list links', () => {
    expect(parseEd2kLink('ed2k://|server|207.44.222.51|4242|/')).toEqual({kind: 'server', host: '207.44.222.51', port: 4242});
    expect(parseEd2kLink('ed2k://|serverlist|http://example.org/server.met|/')).toEqual({
      kind: 'serverlist',
      url: 'http://example.org/server.met',
    });
  });

  it('rejects broken links', () => {
    expect(parseEd2kLink('magnet:?xt=urn:btih:abc')).toBeNull();
    expect(parseEd2kLink(`ed2k://|file||10|${HASH}|/`)).toBeNull();
    expect(parseEd2kLink(`ed2k://|file|a|0|${HASH}|/`)).toBeNull();
    expect(parseEd2kLink(`ed2k://|file|a|12x|${HASH}|/`)).toBeNull();
    expect(parseEd2kLink('ed2k://|file|a|10|nothex|/')).toBeNull();
    expect(parseEd2kLink('ed2k://|server|bad host|4242|/')).toBeNull();
    expect(parseEd2kLink('ed2k://|server|1.2.3.4|0|/')).toBeNull();
    expect(parseEd2kLink('ed2k://|serverlist|ftp://x/server.met|/')).toBeNull();
    expect(parseEd2kLink('ed2k://|friend|x|/')).toBeNull();
  });

  it('ignores a bad part hash list', () => {
    expect(parseEd2kLink(`ed2k://|file|a|10|${HASH}|p=zz|/`)).not.toHaveProperty('partHashes');
  });
});

it('recognises eD2k links', () => {
  expect(isEd2kLink(' ed2k://|file|a|1|x|/')).toBe(true);
  expect(isEd2kLink('ed2k://%7Cserver%7C1.2.3.4%7C4661%7C/')).toBe(true);
  expect(isEd2kLink('https://example.org')).toBe(false);
});

it('finds links in copied text', () => {
  const file = `ed2k://|file|Debian Netinst.iso|661651456|${HASH}|/`;
  const withSources = `ed2k://|file|b.iso|10|${HASH}|/|sources,1.2.3.4:4662|/`;
  expect(ed2kLinksIn(`Get ${file} and ${withSources} now. Also ed2k://|server|1.2.3.4|4661|/`)).toEqual([
    file,
    withSources,
    'ed2k://|server|1.2.3.4|4661|/',
  ]);
  expect(ed2kLinksIn('nothing here')).toEqual([]);
});

it('builds a file link that parses back', () => {
  const link = ed2kFileLink({name: 'a b|c.iso', size: 42, hash: HASH.toUpperCase()});
  expect(parseEd2kLink(link)).toMatchObject({name: 'a b|c.iso', size: 42, hash: HASH});
});

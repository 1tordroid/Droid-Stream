// Reading titles from about 60 real-world file and folder names.
import {parseNetlibPath} from '../src/lib/netlib/parsePath';

const tree: Array<Record<string, any>> = require('./fixtures/netlibTree.json');

const parse = (path: string) => {
  const parts = path.split('/');
  return parseNetlibPath(parts.slice(0, -1), parts[parts.length - 1]);
};

describe('netlib path parsing', () => {
  it.each(tree.map(row => [row.path, row]))('%s', (path, row) => {
    const parsed = parse(path as string);
    const {path: _path, ...expected} = row as Record<string, any>;
    expect(parsed).toMatchObject(expected);
    if (expected.kind !== 'episode') expect(parsed.season).toBeUndefined();
  });

  it('puts videos under an extras folder in Other', () => {
    expect(parse('Show/Season 1/Featurettes/Behind.mkv')).toMatchObject({kind: 'other', extra: true});
  });
});

jest.mock('react-native-mmkv-storage', () => ({
  MMKVLoader: jest.fn().mockImplementation(() => ({
    withInstanceID: () => ({withEncryption: () => ({recoverOnKeyLoss: () => ({initialize: () => ({getString: () => undefined, setString: jest.fn()})})}), initialize: () => ({getString: () => undefined, setString: jest.fn()})}),
    withEncryption: () => ({initialize: () => ({getString: () => undefined, setString: jest.fn()})}),
    initialize: () => ({getString: () => undefined, setString: jest.fn()}),
  })),
}));

import {findImdb} from '../src/lib/stremio';

const respond = (metas: object[]) => {
  global.fetch = jest.fn().mockResolvedValue({ok: true, json: async () => ({metas})}) as any;
};

describe('findImdb', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  it('does not pick a title only because the year matches', async () => {
    respond([{id: 'tt1', type: 'movie', name: 'An Unrelated Documentary', releaseInfo: '2010'}]);
    await expect(findImdb('Sintel', 'movie', 2010)).resolves.toBeUndefined();
  });

  it('ignores a leading article', async () => {
    respond([
      {id: 'tt2', type: 'movie', name: 'Matrix of Love', releaseInfo: '2008'},
      {id: 'tt0133093', type: 'movie', name: 'The Matrix', releaseInfo: '1999'},
    ]);
    await expect(findImdb('Matrix', 'movie')).resolves.toMatchObject({id: 'tt0133093'});
  });

  it('uses the year to choose between titles with the same name', async () => {
    respond([
      {id: 'old', type: 'movie', name: 'Dune', releaseInfo: '1984'},
      {id: 'new', type: 'movie', name: 'Dune', releaseInfo: '2021'},
    ]);
    await expect(findImdb('Dune', 'movie', 2021)).resolves.toMatchObject({id: 'new'});
  });
});

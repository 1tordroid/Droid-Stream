import {
  insertRankedRow,
  rankPosts,
  titleMatchScore,
} from '../src/lib/search/rankSearchResults';

describe('search ranking', () => {
  it('scores exact, partial and unrelated titles in order', () => {
    const exact = titleMatchScore('The Office', 'the office');
    const longer = titleMatchScore('The Office', 'The Office (US) Season 1');
    const partial = titleMatchScore('The Office', 'Office Space');
    const none = titleMatchScore('The Office', 'Breaking Bad');
    expect(exact).toBe(1);
    expect(longer).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(none);
    expect(none).toBe(0);
    expect(titleMatchScore('Amélie', 'Amelie')).toBe(1);
  });

  it('sorts posts best first and keeps ties in provider order', () => {
    const posts = [{title: 'Dune Part Two'}, {title: 'Other'}, {title: 'Dune'}, {title: 'Another'}];
    expect(rankPosts('dune', posts).map(p => p.title)).toEqual([
      'Dune',
      'Dune Part Two',
      'Other',
      'Another',
    ]);
  });

  it('inserts a row above rows with a weaker best match', () => {
    const weak = {name: 'a', Posts: [{title: 'Dune Messiah Novel Reading'}]};
    const none = {name: 'b', Posts: [{title: 'Bad'}]};
    const strong = {name: 'c', Posts: [{title: 'Dune'}]};
    let rows = insertRankedRow('dune', [], weak);
    rows = insertRankedRow('dune', rows, none);
    rows = insertRankedRow('dune', rows, strong);
    expect(rows.map(r => r.name)).toEqual(['c', 'a', 'b']);
  });
});

import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';
import Markdown from 'react-native-markdown-display';

// react-native-markdown-display asks for markdown-it 10, which has known
// denial-of-service bugs. package.json overrides it with markdown-it 14, so
// these tests check that update notes still render the way the dialog
// expects with the newer parser.

const renderMarkdown = (source: string) => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<Markdown>{source}</Markdown>);
  });
  return tree;
};

const visibleText = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .flatMap(node =>
      React.Children.toArray(node.props.children).filter(
        (child): child is string => typeof child === 'string',
      ),
    )
    .join('');

describe('Markdown in dialogs', () => {
  it('renders release notes with headings, lists, emphasis, code and links', () => {
    const tree = renderMarkdown(
      [
        '## What changed',
        '',
        '- **Faster** start up',
        '- Fixed `Play` on the Info page',
        '',
        'Read more on [GitHub](https://github.com/1tordroid/Droid-Stream).',
      ].join('\n'),
    );
    const text = visibleText(tree);

    expect(text).toContain('What changed');
    expect(text).toContain('Faster');
    expect(text).toContain('start up');
    expect(text).toContain('Play');
    expect(text).toContain('GitHub');
    expect(text).not.toContain('**');
    expect(text).not.toContain('](');

    const link = tree.root
      .findAllByType(Text)
      .find(node => typeof node.props.onPress === 'function');
    expect(link).toBeDefined();
  });

  it('shows escaped characters as plain text', () => {
    const text = visibleText(renderMarkdown('Use \\*stars\\* and 5 \\< 6'));

    expect(text).toContain('*stars*');
    expect(text).toContain('5 < 6');
  });

  it('turns straight quotes into typographic quotes', () => {
    const text = visibleText(renderMarkdown('"Quoted" and it\'s fine'));

    expect(text).toContain('“Quoted”');
    expect(text).toContain('it’s');
  });
});

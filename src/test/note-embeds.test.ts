import * as assert from 'assert';

import MarkdownIt = require('markdown-it');

import { parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  addNoteEmbedRenderer,
  resolveEmbed,
  withoutFrontmatter,
} from '../ui/preview/noteEmbeds';

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(notes).map(([filePath, content]) => [
        filePath,
        parseMarkdown(filePath, content),
      ]),
    ),
  );
}

const index = indexOf({
  'notes/Atlas.md': [
    '---',
    'project: atlas',
    '---',
    '# Atlas',
    '',
    'The programme.',
    '',
    '## Decision',
    '',
    'We sign. ^signed',
    '',
    '### Terms',
    '',
    'Net 30.',
  ].join('\n'),
  'notes/People.md': '# People',
  'archive/People.md': '# People',
});

function render(source: string, snapshot = index): string {
  const md = addNoteEmbedRenderer(new MarkdownIt(), {
    getIndex: () => snapshot,
  });
  return md.render(source);
}

suite('Note embeds', () => {
  test('draws a section, and everything nested under it', () => {
    const html = render('Before\n\n![[Atlas#Decision]]\n\nAfter');
    assert.ok(html.includes('class="deckard-embed'), html);
    assert.ok(html.includes('Atlas › Decision'), html);
    assert.ok(html.includes('<p>We sign.'), 'the section body');
    assert.ok(html.includes('Net 30.'), 'the heading nested under it');
    assert.ok(html.includes('<p>Before</p>'), 'the note around it is untouched');
  });

  test('draws a whole note without its front matter', () => {
    const html = render('![[Atlas]]');
    assert.ok(html.includes('<h1>Atlas</h1>'), html);
    assert.ok(html.includes('The programme.'));
    assert.ok(!html.includes('project: atlas'), 'front matter is not content');
    assert.strictEqual(
      withoutFrontmatter('---\na: 1\n---\n\n# Title\n'),
      '# Title\n',
    );
    assert.strictEqual(withoutFrontmatter('# Title\n'), '# Title\n');
  });

  test('draws one marked line, without its marker', () => {
    const html = render('![[Atlas#^signed]]');
    assert.ok(html.includes('Atlas#^signed'), 'the header names the marker');
    assert.ok(
      html.includes('<p>We sign.</p>'),
      'the line is drawn without the marker that names it',
    );
  });

  test('reads the note it is written in from the source being drawn', () => {
    const html = render(
      ['# Journal', '', '## Today', '', 'Wrote it up.', '', '![[#Today]]'].join(
        '\n',
      ),
    );
    assert.ok(html.includes('Wrote it up.'), html);
  });

  test('says what it could not find, and keeps reading the note', () => {
    const missing = render('![[Nowhere]]\n\nStill here.');
    assert.ok(missing.includes('No note is named &quot;Nowhere&quot; yet.'), missing);
    assert.ok(missing.includes('Still here.'));

    assert.ok(
      render('![[People]]').includes('names 2 notes'),
      'a name two notes share reads neither',
    );
    assert.ok(render('![[Atlas#Nowhere]]').includes('has no heading'));
    assert.ok(render('![[Atlas#^nothing]]').includes('is marked ^nothing'));
  });

  test('leaves an attachment, and an embed inside a sentence, as written', () => {
    const image = render('![[diagram.png]]');
    assert.ok(!image.includes('deckard-embed'), image);
    const inline = render('See ![[Atlas#Decision]] for the call.');
    assert.ok(!inline.includes('deckard-embed'), inline);
  });

  test('stops drawing an embed that embeds itself', () => {
    const loop = indexOf({
      'notes/A.md': '# A\n\n![[B]]\n',
      'notes/B.md': '# B\n\n![[A]]\n',
    });
    const html = render('![[A]]', loop);
    assert.ok(html.includes('Embedded too deeply to draw here.'), html);
  });

  test('waits for the index rather than reporting a missing note', () => {
    assert.deepStrictEqual(resolveEmbed('Atlas', '', undefined), {
      kind: 'missing',
      reason: 'Deckard is indexing the workspace…',
    });
    assert.deepStrictEqual(resolveEmbed('', '', index), {
      kind: 'missing',
      reason: 'This embed names nothing.',
    });
  });

  test('links an embed to the line it came from', () => {
    const embed = resolveEmbed('Atlas#Decision', '', index);
    assert.strictEqual(embed.kind, 'note');
    assert.strictEqual(
      embed.kind === 'note' ? embed.href : undefined,
      '/notes/Atlas.md#L8',
    );
  });
});

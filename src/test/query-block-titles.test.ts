import * as assert from 'assert';

import * as corpus from './indexCorpus';
import { stripTrailingTags } from '../domain/ranking/entryLabels';
import { renderQueryBlockHtml } from '../ui/preview/queryBlockHtml';
import { parseQueryBlockInfo } from '../ui/state/queryBlockState';
import { renderMarkdownInline } from '../ui/webview/rendering';
import { createQueryContext } from '../domain/query/queryContext';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';

/**
 * The query block's titles, written from tokens, held to what rendering.ts
 * wrote for every title the corpora give a block: each heading, file name,
 * and task title of the sample workspace, the development notes, and the
 * fixtures. It lives as long as rendering.ts does; the recorded titles in
 * query-block.test.ts stay after it.
 */
suite('Query block titles, as rendering.ts wrote them', () => {
  test('every title of the corpora is written byte for byte as before', () => {
    const files = [
      ...corpus.parseNotes(corpus.sampleNotes()),
      ...corpus.parseNotes(corpus.developmentNotes()),
      ...corpus.parseNotes([...corpus.edgeCaseNotes(), ...corpus.randomNotes(1, 80), ...corpus.randomNotes(7, 80), ...corpus.randomNotes(42, 150)]),
    ];
    const titles = new Set<string>();
    for (const file of files) {
      const fileName = file.filePath.split('/').pop() ?? file.filePath;
      titles.add(fileName);
      file.sections.forEach((section) => titles.add(stripTrailingTags(section.heading) || section.heading.trim() || fileName));
      file.tasks.forEach((task) => titles.add(stripTrailingTags(task.title) || task.title.trim()));
    }
    assert.ok(titles.size > 1000, `${titles.size} titles`);
    const index = buildWorkspaceIndex(new Map([['notes/a.md', parseMarkdown('notes/a.md', '# A\n- [ ] x #project/atlas\n')]]));
    const [task] = [...index.tasks.values()];
    const written = (title: string): string => {
      // A new index each time, since a block's results are kept for the index they were read from.
      const titled = { ...index, tasks: new Map([[task.id, { ...task, title, lineNumber: 77 }]]) };
      const html = renderQueryBlockHtml('tag = #project/atlas', parseQueryBlockInfo('deckard')!, titled, {
        queryContext: createQueryContext(Date.now()),
      });
      return /#L77">([\s\S]*?)<\/a>/.exec(html)?.[1] ?? 'no title link';
    };
    const differ = [...titles].filter((title) => written(title) !== renderMarkdownInline(title).replace(/<a\b[^>]*>|<\/a>/g, ''));
    assert.deepStrictEqual(differ, [], `${differ.length} of ${titles.size} differ`);
  });
});

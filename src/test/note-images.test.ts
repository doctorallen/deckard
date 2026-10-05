import * as assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseBlockMarkdown } from '../domain/markdown/markdownTokens';
import { mapInlineTokens } from '../domain/markdown/inline';
import { readNoteImage } from '../ui/webview/pages/notePage/noteImages';

suite('Images on the Note page', () => {
  test('an image is read as its path and alt text there, and as its alt text from the web', () => {
    const inline = (source: string) => mapInlineTokens(parseBlockMarkdown(source).find((token) => token.type === 'inline')?.children ?? [], { images: true });
    assert.deepStrictEqual(inline('See ![the flow](img/flow.png).'), [
      { kind: 'text', text: 'See ' },
      { kind: 'image', src: 'img/flow.png', alt: 'the flow' },
      { kind: 'text', text: '.' },
    ]);
    assert.deepStrictEqual(inline('![logo](https://example.com/logo.png)'), [{ kind: 'text', text: 'logo' }], 'nothing from the network');
    assert.deepStrictEqual(mapInlineTokens(parseBlockMarkdown('![x](a.png)')[1].children ?? []), [], 'other pages draw no image');
  });

  test('the host reads an image beside the note, or at the top, and says why it read none', () => {
    const root = mkdtempSync(join(tmpdir(), 'deckard-images-'));
    try {
      mkdirSync(join(root, 'notes', 'img'), { recursive: true });
      writeFileSync(join(root, 'notes', 'img', 'flow.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      writeFileSync(join(root, 'top.png'), Buffer.from([1, 2, 3]));
      writeFileSync(join(root, 'notes', 'secret.txt'), 'not an image');
      const scope = { noteFsPath: join(root, 'notes', 'plan.md'), rootFsPath: root };
      const read = (src: string) => readNoteImage({ kind: 'image', src, alt: 'x' }, scope);
      assert.deepStrictEqual(read('img/flow.png'), { kind: 'image', src: 'data:image/png;base64,iVBORw==', alt: 'x' });
      assert.match((read('top.png') as { src: string }).src, /^data:image\/png;base64,/, 'from the top, as ![[top.png]] names it');
      assert.strictEqual((read('../../outside.png') as { missing?: string }).missing, 'it is outside the workspace folder');
      assert.strictEqual((read('secret.txt') as { missing?: string }).missing, 'it is not an image file');
      assert.strictEqual((read('img/gone.png') as { missing?: string }).missing, 'no file is there');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

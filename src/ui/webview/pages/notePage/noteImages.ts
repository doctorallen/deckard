import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';

import type { InlineToken } from '../../../../domain/model/inline';
import type { NoteBlock, NotePageSnapshot } from '../../../protocol/notePage';

/**
 * A note's images, read for the Note page.
 *
 * The page may load nothing from the disk or the network, so the host reads
 * each image a note writes, `![alt](diagram.png)`, from the note's own
 * folder and hands it over as a `data:` URI. A path that leaves the
 * workspace folder, a file that is not an image, or one too large to send
 * is left out, and the page says why where it would have been.
 */

/** The image files a page draws, by extension, as the type a `data:` URI names. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

/** The largest image a page is sent, so a screenshot folder cannot stall it. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Where a note is on disk, and the folder it may read images from. */
export interface ImageScope {
  noteFsPath: string;
  rootFsPath: string;
}

/** An image token with its file read, or the reason it was not. */
export function readNoteImage(token: Extract<InlineToken, { kind: 'image' }>, scope: ImageScope): InlineToken {
  let path: string;
  try {
    const written = decodeURIComponent(token.src);
    path = normalize(join(dirname(scope.noteFsPath), written));
    // `![[diagram.png]]` names a file as Obsidian does, from the vault's top
    // when it is not beside the note.
    if (!existsSync(path)) {
      path = normalize(join(scope.rootFsPath, written));
    }
  } catch {
    return { ...token, missing: 'its path cannot be read' };
  }
  const inside = relative(scope.rootFsPath, path);
  if (inside.startsWith('..') || isAbsolute(inside)) {
    return { ...token, missing: 'it is outside the workspace folder' };
  }
  const type = IMAGE_TYPES[path.slice(path.lastIndexOf('.')).toLowerCase()];
  if (!type) {
    return { ...token, missing: 'it is not an image file' };
  }
  try {
    if (statSync(path).size > MAX_IMAGE_BYTES) {
      return { ...token, missing: 'it is larger than 4 MB; open it from the editor' };
    }
    return { ...token, src: `data:${type};base64,${readFileSync(path).toString('base64')}` };
  } catch {
    return { ...token, missing: 'no file is there' };
  }
}

/** The snapshot with every image in its blocks read, its own and its embeds' each from its own note. */
export function readSnapshotImages(snapshot: NotePageSnapshot, scope: ImageScope, fsPathOf: (filePath: string) => string | undefined): NotePageSnapshot {
  return { ...snapshot, blocks: readBlocks(snapshot.blocks, scope, fsPathOf) };
}

function readBlocks(blocks: readonly NoteBlock[], scope: ImageScope, fsPathOf: (filePath: string) => string | undefined): NoteBlock[] {
  return blocks.map((block): NoteBlock => {
    switch (block.kind) {
      case 'paragraph':
      case 'heading':
        return { ...block, children: readTokens(block.children, scope) };
      case 'list':
        return { ...block, items: block.items.map((item) => ({ ...item, blocks: readBlocks(item.blocks, scope, fsPathOf) })) };
      case 'quote':
        return { ...block, children: readBlocks(block.children, scope, fsPathOf) };
      case 'table':
        return { ...block, rows: block.rows.map((row) => row.map((cell) => readTokens(cell, scope))) };
      case 'embed': {
        const embedded = block.source ? fsPathOf(block.source.filePath) : undefined;
        return block.blocks && embedded
          ? { ...block, blocks: readBlocks(block.blocks, { ...scope, noteFsPath: embedded }, fsPathOf) }
          : block;
      }
      case 'code':
      case 'rule':
      case 'query':
        return block;
    }
  });
}

function readTokens(tokens: readonly InlineToken[], scope: ImageScope): InlineToken[] {
  return tokens.map((token): InlineToken => {
    if (token.kind === 'image') {
      return readNoteImage(token, scope);
    }
    return 'children' in token ? { ...token, children: readTokens(token.children, scope) } : token;
  });
}

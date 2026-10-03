import { WorkspaceIndex } from '../model';
import {
  createNoteTitleMap,
  findLinkedBlock,
  findLinkedSection,
  parseWikiTarget,
  resolveWikiTarget,
} from './backlinks';

/** A complete `[[link]]` in a note's text that opens exactly one note. */
export interface WikiLinkTarget {
  readonly title: string;
  readonly filePath: string;
  readonly startOffset: number;
  readonly endOffset: number;
  /**
   * One-based line the link points into: the heading a `#Heading` names or
   * the line a `#^id` marks, when the note has it.
   */
  readonly line?: number;
}

/**
 * Resolves only exact, case-insensitive title matches so duplicate note names
 * cannot make an editor link point at the wrong file. The rule is the one the
 * editor's reference counts and previews use, so all three agree.
 *
 * `sourcePath` is the note the links are written in, which `[[#Heading]]`
 * points into.
 */
export function findWikiLinkTargets(
  content: string,
  index: WorkspaceIndex,
  sourcePath?: string,
): WikiLinkTarget[] {
  const titles = createNoteTitleMap(index);
  const links: WikiLinkTarget[] = [];
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  for (const match of content.matchAll(pattern)) {
    const target = parseWikiTarget(match[1]);
    const filePath =
      target.note || sourcePath
        ? resolveWikiTarget(titles, target.note, sourcePath ?? '')
        : undefined;
    if (!filePath || match.index === undefined) {
      continue;
    }

    const file = index.files.get(filePath);
    // A `#^id` names a line, a `#Heading` a section; either opens the note
    // where it points rather than at its top.
    const blockLine =
      target.block && file ? findLinkedBlock(file, target.block) : undefined;
    const section =
      target.heading && file ? findLinkedSection(file, target.heading) : undefined;
    const line = blockLine ?? section?.startLine;
    links.push({
      title: match[1].trim(),
      filePath,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
      ...(line === undefined ? {} : { line }),
    });
  }

  return links;
}

import { formatExcerpt, readProseLines } from '../../domain/markdown/proseExcerpt';
import { Section } from '../../core/types';
import { getSectionLexicalContent } from './wordSimilarity';

/**
 * A section's own prose lines, cached per section. Sections are replaced,
 * never changed, when a note is read again, so the cache stays right and
 * lets go of old sections on its own, as the wording model's does.
 */
const proseLines = new WeakMap<Section, string[]>();

export function getSectionProseLines(section: Section, fileSections: Section[]): string[] {
  let lines = proseLines.get(section);
  if (!lines) {
    lines = readProseLines(getSectionLexicalContent(section, fileSections));
    proseLines.set(section, lines);
  }
  return lines;
}

/**
 * What a section card previews: its own prose, from the first line holding
 * one of `terms`, or else its first line; nothing for an inline tagged line,
 * whose title is its whole text, or when the excerpt only repeats the title.
 */
export function createSectionExcerpt(
  section: Section,
  fileSections: Section[],
  title: string,
  terms: readonly string[] = [],
): string | undefined {
  if (section.isInline) {
    return undefined;
  }
  const excerpt = formatExcerpt(getSectionProseLines(section, fileSections), terms);
  return excerpt && excerpt.replace(/^…/, '').trim() !== title.trim() ? excerpt : undefined;
}

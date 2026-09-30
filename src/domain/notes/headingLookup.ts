import { Section } from '../model';

/** The innermost heading a one-based line is in, tagged or not. */
export function findHeadingAtLine(
  sections: readonly Section[],
  line: number,
): Section | undefined {
  return sections
    .filter(
      (section) =>
        !section.isInline &&
        section.startLine <= line &&
        section.endLine >= line,
    )
    .sort(
      (left, right) =>
        right.startLine - left.startLine ||
        right.headingLevel - left.headingLevel,
    )[0];
}

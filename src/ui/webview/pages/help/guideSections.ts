/**
 * A rendered guide page cut into its sections, for Help's This page
 * (plan 48, section 2): an entry's name is its section's heading, its body
 * the section, and its line in the list the section's first sentence. The
 * HTML is what VS Code's Markdown engine rendered from the guide the VSIX
 * ships, so its headings carry the anchors `guideSlug` predicts.
 */

/** One section of a guide page: from its heading to the next heading as high or higher. */
export interface GuideSection {
  /** The heading's anchor, such as `lanes`. */
  id: string;
  /** 1 for the page's title, 2 for a section, and so on. */
  level: number;
  /** The heading's words. */
  title: string;
  /** What follows the heading, its subsections included, as rendered. */
  html: string;
}

const HEADING = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/g;

/** Every section of a rendered page that has an anchor, in the order written. */
export function cutGuideSections(html: string): GuideSection[] {
  const headings: Array<{ level: number; id: string | undefined; title: string; start: number; end: number }> = [];
  for (const match of html.matchAll(HEADING)) {
    const id = /\sid="([^"]+)"/.exec(match[2])?.[1];
    headings.push({
      level: Number(match[1]),
      id,
      title: textOf(match[3]),
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  const sections: GuideSection[] = [];
  headings.forEach((heading, at) => {
    if (!heading.id) {
      return;
    }
    const next = headings.slice(at + 1).find((other) => other.level <= heading.level);
    sections.push({
      id: heading.id,
      level: heading.level,
      title: heading.title,
      html: html.slice(heading.end, next ? next.start : html.length).trim(),
    });
  });
  return sections;
}

/** The section of a rendered page with this anchor, or undefined. */
export function findGuideSection(html: string, id: string): GuideSection | undefined {
  return cutGuideSections(html).find((section) => section.id === id);
}

/**
 * Some HTML with its tags taken out, again until none is left, so taking one
 * out cannot join the text either side of it into another.
 */
function withoutTags(html: string): string {
  let text = html;
  let before: string;
  do {
    before = text;
    text = text.replace(/<[^<>]*>/g, '');
  } while (text !== before);
  return text;
}

/**
 * The words of some HTML, its blocks parted by a space and its entities
 * read. The result is text, not HTML: whoever draws it escapes it.
 */
export function textOf(html: string): string {
  const parted = html.replace(/<\/(p|li|td|th|tr|h[1-6]|pre|blockquote)>/g, ' ');
  return withoutTags(parted)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The sentences of some HTML's words. */
export function sentencesOf(html: string): string[] {
  return textOf(html)
    .split(/(?<=[.!?:])\s+(?=[A-Z0-9*`"“(@#])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** A section's first sentence, the line it is listed by. */
export function firstSentence(html: string): string {
  return sentencesOf(html)[0] ?? '';
}

/** The first sentence of some HTML that names `words`, matched without case, or undefined. */
export function sentenceNaming(html: string, words: string): string | undefined {
  const wanted = words.toLowerCase();
  return sentencesOf(html).find((sentence) => sentence.toLowerCase().includes(wanted));
}

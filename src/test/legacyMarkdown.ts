import MarkdownIt = require('markdown-it');

/**
 * Note Markdown as the pages drew it before the token tree: the HTML that
 * src/ui/webview/rendering.ts gave the template script, for the suites that
 * hold the Preact pages to the template (webview-shared, webview-tasks, and
 * webview-search). rendering.ts ran markdown-it and then sanitize-html; both
 * left the extension in Phase 6 step 6, so this writes what the sanitizer
 * kept of markdown-it's HTML with markdown-it's own renderer:
 *
 * - the tags it removed and kept the words of: `<s>` and a table's;
 * - the tag it removed with everything in it: `<img>`;
 * - every attribute but a link's `href` and `title`, an empty one, and an
 *   `href` whose scheme is not http, https, or mailto, or that starts
 *   with `//`.
 *
 * Before rendering.ts was deleted, this and it were compared over every
 * excerpt and title those suites draw, as the DOM test:dom normalizes, and
 * agreed on all of them. It is a test oracle only; nothing ships it.
 */
const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: true,
});

// The tag goes and the line ends markdown-it writes around it stay, as
// they stayed as text when the sanitizer took the tag out.
for (const kind of ['s', 'table', 'thead', 'tbody', 'tr', 'th', 'td']) {
  for (const edge of ['open', 'close']) {
    markdown.renderer.rules[`${kind}_${edge}`] = (tokens, at, options) =>
      markdown.renderer.renderToken(tokens, at, options).replace(/<[^>]*>/, '');
  }
}
markdown.renderer.rules.image = () => '';

/** A scheme the sanitizer let a link keep: http, https, mailto, or none. */
function keptHref(href: string): boolean {
  const bare = href.replace(/[\x00-\x20]+/g, '');
  if (bare.startsWith('//')) {
    return false;
  }
  const scheme = /^([a-zA-Z][a-zA-Z0-9.\-+]*):/.exec(bare);
  return !scheme || ['http', 'https', 'mailto'].includes(scheme[1].toLowerCase());
}

const renderAttrs = markdown.renderer.renderAttrs.bind(markdown.renderer);
markdown.renderer.renderAttrs = (token) => {
  if (token.type !== 'link_open' || !token.attrs) {
    return '';
  }
  const kept = token.attrs.filter(([name, value]) => value !== '' && (name === 'title' || (name === 'href' && keptHref(value))));
  return renderAttrs(Object.assign(Object.create(Object.getPrototypeOf(token) as object) as MarkdownIt.Token, token, { attrs: kept }));
};

/** A note's Markdown as rendering.ts's renderMarkdown wrote it. */
export function renderMarkdown(content: string): string {
  return markdown.render(content);
}

/** A title's inline Markdown as rendering.ts's renderMarkdownInline wrote it. */
export function renderMarkdownInline(content: string): string {
  return markdown.renderInline(content);
}

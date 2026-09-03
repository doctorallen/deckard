import MarkdownIt = require('markdown-it');
import sanitizeHtml = require('sanitize-html');

/**
 * Render predictable Markdown without allowing source HTML or automatic links
 * to expand the webview's content or security surface unexpectedly.
 */
const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: true,
});

/**
 * Renders a block of note content and sanitizes the generated HTML.
 */
export function renderMarkdown(content: string): string {
  return sanitizeMarkdownHtml(markdown.render(content));
}

/**
 * Renders task titles as inline Markdown using the same sanitizer as note bodies.
 */
export function renderMarkdownInline(content: string): string {
  return sanitizeMarkdownHtml(markdown.renderInline(content));
}

/**
 * Allows only the tags, attributes, and URL schemes the webviews need.
 *
 * Sanitization remains a second boundary after Markdown rendering because note
 * content is user-controlled and is inserted into a scripted webview.
 */
function sanitizeMarkdownHtml(content: string): string {
  return sanitizeHtml(content, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      'del',
      'code',
      'pre',
      'blockquote',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'a',
      'hr',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
  });
}

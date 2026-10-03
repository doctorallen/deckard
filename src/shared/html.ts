/**
 * Escaping for the HTML the extension host writes as text: the Markdown
 * preview's plugins, the page shells, the Help page, and the Related Notes
 * diagnostic. The pages draw with Preact, which escapes what it renders,
 * and write no HTML as text.
 */

/**
 * A value made safe to place in HTML text or in a quoted attribute, single or
 * double: `&`, `<`, `>`, `"`, and `'` become entities, so the page reads back
 * exactly the text given. `&` goes first, so the entities the others become
 * are not escaped a second time.
 */
export function escapeHtml(value: string): string {
  return escapeHtmlText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * A value made safe to place in HTML text, and only there: `&`, `<`, and `>`
 * become entities and quotes stay as written. The query block writes a
 * title's words with it, since that is how `sanitize-html` wrote them, so
 * the preview's HTML stays byte for byte what it was. Anything bound for an
 * attribute takes `escapeHtml`.
 */
export function escapeHtmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

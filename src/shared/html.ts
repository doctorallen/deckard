/**
 * Escaping for the HTML the extension host writes as text: the Markdown
 * preview's plugins, the Help page, and the Related Notes diagnostic. Page
 * scripts keep their own copy until they become modules (19-refactor.md,
 * §2.4), since they cannot import host code.
 */

/**
 * A value made safe to place in HTML text or in a quoted attribute, single or
 * double: `&`, `<`, `>`, `"`, and `'` become entities, so the page reads back
 * exactly the text given. `&` goes first, so the entities the others become
 * are not escaped a second time.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

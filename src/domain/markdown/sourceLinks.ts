/**
 * Links a result to its source line.
 *
 * Deckard keys files by workspace-relative path, and the preview resolves a
 * link that starts with `/` against the workspace folder, so the key needs no
 * translation. `#L12` is the line fragment the preview understands.
 */
export function createPreviewSourceHref(filePath: string, line: number): string {
  const path = filePath.split('/').map(encodeURIComponent).join('/');
  return `/${path}#L${Math.max(1, line)}`;
}

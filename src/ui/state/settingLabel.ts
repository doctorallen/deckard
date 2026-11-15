/**
 * A setting as the Settings editor labels it, for a message to quote:
 * 'mcpServer.port' becomes 'MCP Server: Port', 'templatesFolder' becomes
 * 'Templates Folder'. The key is the part after `deckard.`.
 */
export function settingLabel(key: string): string {
  const words = (segment: string) =>
    segment
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/\s+/)
      .filter(Boolean)
      .map((word) =>
        word.toLowerCase() === 'mcp' ? 'MCP' : word[0].toUpperCase() + word.slice(1),
      )
      .join(' ');
  const segments = key.replace(/^deckard\./, '').split('.').map(words);
  const last = segments.pop() ?? '';
  return segments.length ? `${segments.join(' › ')}: ${last}` : last;
}

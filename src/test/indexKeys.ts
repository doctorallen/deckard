/**
 * The index key the scanner gives a note that no workspace folder holds: its
 * file path with forward slashes, on every system (WorkspaceScanner's
 * getFilePath). A note's title is read from the key's last `/` part, so a
 * test that keyed its index by a Windows file path, backslashes and all,
 * would find no note by its title there.
 */
export function indexKeyOf(uri: { readonly fsPath: string }): string {
  return uri.fsPath.replaceAll('\\', '/');
}

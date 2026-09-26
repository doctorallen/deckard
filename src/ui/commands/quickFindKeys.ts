/**
 * A key as VS Code writes it on this platform: `⌘Enter` and `⌥Enter` on
 * macOS, `Ctrl+Enter` and `Alt+Enter` elsewhere.
 */
export function keyLabel(key: string, platform: NodeJS.Platform = process.platform): string {
  const mac = platform === 'darwin';
  return key
    .split('+')
    .map((part) => {
      switch (part) {
        case 'cmd':
          return mac ? '⌘' : 'Ctrl+';
        case 'alt':
          return mac ? '⌥' : 'Alt+';
        case 'enter':
          return 'Enter';
        default:
          return part;
      }
    })
    .join('');
}

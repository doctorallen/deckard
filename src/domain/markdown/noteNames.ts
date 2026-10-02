/**
 * Names that are attachments rather than notes: an image, a PDF, or a sound
 * or video file. A link or embed that names one is neither drawn as a note
 * nor listed as a missing one.
 */
export const ATTACHMENT = /\.(?:png|jpe?g|gif|svg|webp|bmp|pdf|mp4|mp3|wav|mov|webm)$/i;

/**
 * The file name a note named by a link, a heading, or a hub would get, or
 * undefined when the name cannot be one: empty, `.` or `..`, holding a
 * character a file system refuses, or ending in a dot or a space.
 */
export function getExtractedNoteFileName(name: string): string | undefined {
  const trimmedName = name.trim();
  const baseName = trimmedName.replace(/\.md$/i, '').trim();

  if (
    !baseName ||
    baseName === '.' ||
    baseName === '..' ||
    /[/\\\u0000-\u001f\u007f<>:"|?*]/.test(baseName) ||
    /[. ]$/.test(baseName)
  ) {
    return undefined;
  }

  return `${baseName}.md`;
}

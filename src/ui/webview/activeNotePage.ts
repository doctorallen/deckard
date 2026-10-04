import { ActiveSource } from './host/activeSource';

/** The note page, as the Related Notes sidebar reads it: the note it shows, and the line it was asked for at. */
export interface NotePageSource {
  readonly location: { filePath: string; line?: number } | undefined;
}

/**
 * Knows whether the note page is the active editor. While it is, Related
 * Notes follows the note it shows as it would follow that note in a text
 * editor, the line the page was asked for standing in for the cursor. It is
 * the `ActiveSource` every page with a part in the sidebar shares, for the
 * note page.
 */
export class ActiveNotePage extends ActiveSource<NotePageSource> {}

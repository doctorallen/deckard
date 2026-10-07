import { findSameSection } from '../domain/capture/captureLines';
import type { PinnedNote, Section, WorkspaceIndex } from '../domain/model';

/**
 * Writing a new task into a note: at its end, or under a chosen heading.
 *
 * Add Task asks, and presents what CaptureService returns; which heading
 * the task goes under once the note has changed, and which heading is
 * remembered as used, are decided here.
 */

/** The notes a capture is written into, as they stand now. */
export interface CaptureNotes<U> {
  /** The URI a note's index path names, or undefined when no file has it. */
  uriOf(filePath: string): PromiseLike<U | undefined>;
  /** The note's sections as it reads now, its editor's copy when it is open. */
  sectionsOf(uri: U): PromiseLike<readonly Section[]>;
  /**
   * Adds `line` to the note, under the section's own lines when one is
   * given, and saves it. The zero-based line the task is on, or undefined
   * when the edit was refused.
   */
  append(uri: U, line: string, section?: Pick<Section, 'startLine' | 'endLine'>): PromiseLike<number | undefined>;
}

/** What CaptureService reads and writes through. */
export interface CaptureServiceOptions<U> {
  index: { getSnapshot(): WorkspaceIndex };
  notes: CaptureNotes<U>;
  /** Where a heading written under is remembered, so it is offered first next time. */
  recentHeadings: { recordRecentHeading(pin: PinnedNote): PromiseLike<void> };
}

/** A capture into a note: added on a line, or refused by the note's editor. */
export type CaptureResult<U> =
  | { kind: 'added'; uri: U; taskLine: number }
  | { kind: 'refused'; uri: U };

/**
 * A capture under a heading: as for any note, or not written because the
 * note or the heading is no longer where the index had it.
 */
export type HeadingCaptureResult<U> =
  | CaptureResult<U>
  | { kind: 'missing-note' }
  | { kind: 'missing-heading' };

/** Writes new tasks into notes, and remembers the headings they went under. */
export class CaptureService<U> {
  /** Reads the index and writes the notes and the recent headings through `options`. */
  public constructor(private readonly options: CaptureServiceOptions<U>) {}

  /** Adds `line` to the note at `noteUri`, such as today's, after its last list item or text. */
  public async captureToNote(noteUri: U, line: string): Promise<CaptureResult<U>> {
    const taskLine = await this.options.notes.append(noteUri, line);
    return taskLine === undefined ? { kind: 'refused', uri: noteUri } : { kind: 'added', uri: noteUri, taskLine };
  }

  /**
   * Adds `line` under the heading chosen from the index: under its own
   * lines, above any heading nested in it. The note may have changed since
   * it was indexed, so the heading is found again in the note as it is now,
   * and once the line is in, the heading is remembered as used.
   */
  public async captureUnderHeading(line: string, chosen: Section): Promise<HeadingCaptureResult<U>> {
    const { index, notes } = this.options;
    const uri = await notes.uriOf(chosen.filePath);
    if (!uri) {
      return { kind: 'missing-note' };
    }
    const live = await notes.sectionsOf(uri);
    const saved = index.getSnapshot().files.get(chosen.filePath)?.sections ?? [];
    const section = findSameSection(saved, chosen, live);
    if (!section) {
      return { kind: 'missing-heading' };
    }
    const taskLine = await notes.append(uri, line, {
      startLine: section.startLine,
      endLine: section.bodyEndLine,
    });
    if (taskLine === undefined) {
      return { kind: 'refused', uri };
    }
    // Remembered as the note held it when written to, since the index may
    // have read the note again since the heading was chosen.
    await this.options.recentHeadings.recordRecentHeading({
      filePath: chosen.filePath,
      heading: section.heading,
      headingLevel: section.headingLevel,
      occurrence: live.filter(
        (other) =>
          !other.isInline &&
          other.heading === section.heading &&
          other.headingLevel === section.headingLevel &&
          other.startLine < section.startLine,
      ).length,
    });
    return { kind: 'added', uri, taskLine };
  }
}

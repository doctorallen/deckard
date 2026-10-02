import { findSameSection } from '../domain/capture/captureLines';
import type { PinnedNote, Section, WorkspaceIndex } from '../domain/model';
import type { KeyValueStore } from '../ports/keyValueStore';

/**
 * Capture: writing what was typed into today's note or under a chosen
 * heading, and keeping the words until they are written.
 *
 * The Capture command asks, and presents what CaptureService returns; which
 * heading the words go under once the note has changed, when the draft is
 * let go, and which heading is remembered as used, are decided here.
 */

/** Where a capture goes: today's daily note, or under a chosen heading. */
export type CaptureTarget = 'today' | 'heading';

/** What was being typed when Capture closed without writing it. */
export interface CaptureDraft {
  text: string;
  target: CaptureTarget;
  literal: boolean;
}

const DRAFT_KEY = 'deckard.capture.draft';

/**
 * Keeps what was typed into Capture until it is written, so closing the box,
 * or another quick input taking its place, does not lose the words.
 */
export class CaptureDrafts {
  /** Keeps the draft in `memory`, the workspace's store. */
  public constructor(private readonly memory: Pick<KeyValueStore, 'get' | 'update'>) {}

  /** The draft, when it was typed into the same command. */
  public read(target: CaptureTarget): CaptureDraft | undefined {
    const draft = this.memory.get<CaptureDraft>(DRAFT_KEY);
    return draft &&
      typeof draft.text === 'string' &&
      draft.text.trim() !== '' &&
      draft.target === target
      ? { text: draft.text, target, literal: draft.literal === true }
      : undefined;
  }

  /** Keeps `draft` for the next Capture, in place of any before it. */
  public save(draft: CaptureDraft): PromiseLike<void> {
    return this.memory.update(DRAFT_KEY, draft);
  }

  /** Lets the draft go, once its words are written or the box is emptied. */
  public clear(): PromiseLike<void> {
    return this.memory.update(DRAFT_KEY, undefined);
  }
}

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
  drafts: Pick<CaptureDrafts, 'clear'>;
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

/**
 * Writes captures. The draft is let go only once its words are in a note,
 * so a note that refuses the edit, or a heading that is gone, keeps them.
 */
export class CaptureService<U> {
  /** Reads the index and writes the notes, the draft, and the recent headings through `options`. */
  public constructor(private readonly options: CaptureServiceOptions<U>) {}

  /** Adds `line` to today's note at `noteUri`, after its last list item or text. */
  public async captureToToday(noteUri: U, line: string): Promise<CaptureResult<U>> {
    const taskLine = await this.options.notes.append(noteUri, line);
    if (taskLine === undefined) {
      return { kind: 'refused', uri: noteUri };
    }
    await this.options.drafts.clear();
    return { kind: 'added', uri: noteUri, taskLine };
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
    await this.options.drafts.clear();
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

import { summarizeTagMerge, TagMergeSummary } from '../domain/index/tagMerge';
import { resolveIndexedTagKey } from '../domain/index/tagNavigation';
import { planTagEdits, RenameTagOptions, TagEdit } from '../domain/markdown/tagRename';
import type { TagInfo, TagReference, WorkspaceIndex } from '../domain/model';

/**
 * Renaming a tag, and merging one tag into another: which notes change, how,
 * and what follows the tag once they have.
 *
 * A rename rewrites every note that carries the tag, which is more than an
 * editor Undo reaches, so the rewrite is planned against the index, checked
 * against the notes as they are now, and written as one write that Undo Last
 * Change takes back. The prompts, the merge confirmation, and every message
 * are the command's; this decides and writes.
 */

/** The edits one note gets, by its index path. */
export interface TagFileEdits {
  filePath: string;
  edits: TagEdit[];
}

/** What a rewrite is, which the write names in its preview and its Undo. */
export interface TagWriteDescription {
  /** Whether the new tag already existed, so the rewrite is a merge. */
  merge: boolean;
  sourceLabel: string;
  replacementLabel: string;
  /** Puts back what the rewrite changed outside the notes, on an Undo. */
  restore: () => Promise<void>;
}

/**
 * Whether a write landed, how many notes it changed, and the handle its Undo
 * works through. A write can land and change nothing, when the reader leaves
 * every change out of the preview.
 */
export type TagWriteOutcome<Handle> =
  | { applied: false }
  | { applied: true; notes: number; handle: Handle };

/**
 * The notes one rename or merge reads and writes, by index path. The command
 * makes one for each rewrite, so each note is looked up once and the write
 * lands on the same notes the plan was checked against.
 */
export interface TagNotes<Handle> {
  /**
   * How the note reads its tags, as its folder's settings say. Every indexed
   * note is asked, so this does not need the note's file.
   */
  optionsFor(filePath: string): Promise<RenameTagOptions>;
  /**
   * The note's text as it is now: its editor's, or the disk's. Asked only of
   * a note the rewrite changes. Rejects when the note cannot be found or
   * opened, which stops the rewrite before anything is written.
   */
  contentOf(filePath: string): Promise<string>;
  /** Writes every note's edits as one write, which Undo takes back. */
  write(files: readonly TagFileEdits[], description: TagWriteDescription): Promise<TagWriteOutcome<Handle>>;
}

/** What a rename reads the notes again with, once they are written. */
export interface TagIndex {
  refresh(): Promise<void>;
}

/** Where favorites, ranking, and saved views name tags, so they follow a rename. */
export interface TagPreferences {
  replaceTagKey(sourceKey: string, targetKey: string): Promise<void>;
  /**
   * What puts back everything kept under `keys` as it is now, leaving every
   * other tag as it is then: a merge's Undo.
   */
  snapshotTagKeys(keys: readonly string[]): () => Promise<void>;
}

/** One rename or merge: which tag, what it becomes, and the index both were chosen from. */
export interface TagRewriteRequest<Handle> {
  /** The index the reader chose from, which the rewrite is planned against. */
  index: WorkspaceIndex;
  source: TagInfo;
  replacement: TagReference;
  notes: TagNotes<Handle>;
}

/**
 * What a rename or merge came to, once any merge is confirmed. Every kind
 * but `written` wrote nothing.
 *
 * - `refused`, `same`: the new tag is the old one, however it was typed.
 * - `stale`: a note changed after the index read it.
 * - `unopened`: a note the rewrite changes could not be found or opened.
 * - `not-found`: no note holds the tag as the notes are now.
 * - `rejected`: VS Code did not accept the edit to these notes.
 * - `unchanged`: the write landed and changed no note.
 * - `written`: the notes, and the preferences, now name the new tag. When
 *   reading the notes again failed, `refreshFailure` holds why.
 */
export type TagRewriteOutcome<Handle> =
  | { kind: 'refused'; reason: 'same' }
  | { kind: 'stale'; filePath: string }
  | { kind: 'unopened'; filePath: string; error: unknown }
  | { kind: 'not-found' }
  | { kind: 'rejected'; filePaths: string[] }
  | { kind: 'unchanged' }
  | {
      kind: 'written';
      merge: boolean;
      /** How many notes the write changed. */
      notes: number;
      handle: Handle;
      refreshFailure?: { error: unknown };
    };

/**
 * What a rename or merge came to, or, when the new tag already exists, the
 * merge waiting on the reader: `merge()` carries it out once they confirm,
 * and nothing happens if they do not, since a merge cannot be separated
 * again afterwards.
 */
export type TagRewriteResult<Handle> =
  | TagRewriteOutcome<Handle>
  | { kind: 'confirm-merge'; summary: TagMergeSummary; merge: () => Promise<TagRewriteOutcome<Handle>> };

/** The rewrite planned against the index, or the note that no longer matches it or cannot be opened. */
type TagRewritePlan =
  | { kind: 'stale'; filePath: string }
  | { kind: 'unopened'; filePath: string; error: unknown }
  | { kind: 'planned'; files: TagFileEdits[]; occurrenceCount: number };

/** What TagService works through besides the notes each rewrite is handed. */
export interface TagServiceCollaborators {
  index: TagIndex;
  /** Absent where no preferences are kept, such as in a test. */
  preferences?: TagPreferences;
}

/**
 * Renames and merges tags across the notes. One is made where the extension
 * starts; it holds nothing between rewrites.
 */
export class TagService {
  /** Takes the index a rename reads the notes again with, and the preferences whose tag keys follow it. */
  public constructor(private readonly collaborators: TagServiceCollaborators) {}

  /**
   * Rewrites every occurrence of one tag as another. When the other tag is
   * already indexed this is a merge, which is confirmed first because
   * renaming back afterwards cannot separate the two tags again.
   */
  public async rewrite<Handle>(request: TagRewriteRequest<Handle>): Promise<TagRewriteResult<Handle>> {
    const { index, source, replacement } = request;
    const targetKey = resolveIndexedTagKey(index.tags, replacement.key);
    if (replacement.key === source.key || targetKey === source.key) {
      return { kind: 'refused', reason: 'same' };
    }
    const summary = targetKey ? summarizeTagMerge(index, source.key, targetKey) : undefined;
    if (summary) {
      return {
        kind: 'confirm-merge',
        summary,
        merge: () => this.write(request, targetKey ?? replacement.key, true),
      };
    }
    return this.write(request, targetKey ?? replacement.key, false);
  }

  /**
   * Plans, writes, and carries the preferences over. `keptKey` is the key the
   * notes carry afterwards: the indexed tag's own when merging, whatever case
   * the reader typed it in.
   */
  private async write<Handle>(
    request: TagRewriteRequest<Handle>,
    keptKey: string,
    merge: boolean,
  ): Promise<TagRewriteOutcome<Handle>> {
    const { source, replacement, notes } = request;
    const plan = await this.plan(request);
    if (plan.kind !== 'planned') {
      return plan;
    }
    if (plan.occurrenceCount === 0) {
      return { kind: 'not-found' };
    }

    // A merge adds the source tag's preferences to the kept tag's, and
    // moving them back afterwards would take the kept tag's own along, so a
    // merge's Undo puts back what each tag had. A rename's moves them back.
    const preferences = this.collaborators.preferences;
    const putBack = merge
      ? preferences?.snapshotTagKeys([source.key, keptKey])
      : () => preferences?.replaceTagKey(keptKey, source.key) ?? Promise.resolve();
    // The write is shown first when it reaches more than one note, and kept
    // afterwards, so `Deckard: Undo Last Change` can take the whole of it back.
    const written = await notes.write(plan.files, {
      merge,
      sourceLabel: source.label,
      replacementLabel: replacement.label,
      restore: async () => {
        await putBack?.();
        await this.collaborators.index.refresh();
      },
    });
    if (!written.applied) {
      return { kind: 'rejected', filePaths: plan.files.map((file) => file.filePath) };
    }
    if (written.notes === 0) {
      return { kind: 'unchanged' };
    }

    // Favorites, ranking, and saved views follow the tag. This runs before the
    // refresh so nothing prunes them while they still name the old key.
    await this.collaborators.preferences?.replaceTagKey(source.key, keptKey);
    const refreshFailure = await this.refresh();
    return {
      kind: 'written',
      merge,
      notes: written.notes,
      handle: written.handle,
      ...(refreshFailure ? { refreshFailure } : {}),
    };
  }

  /**
   * The edits each note needs, planned from the text the index read, as
   * long as each note it touches still reads that way. The first note that
   * does not stops the plan, since a rename written over a note that changed
   * would rewrite what the reader never saw, and so does the first that
   * cannot be opened. A note the rename does not change is never opened.
   */
  private async plan<Handle>({
    index,
    source,
    replacement,
    notes,
  }: TagRewriteRequest<Handle>): Promise<TagRewritePlan> {
    const files: TagFileEdits[] = [];
    let occurrenceCount = 0;
    for (const [filePath, file] of index.files) {
      const planned = planTagEdits(
        file.content,
        source.key,
        replacement,
        await notes.optionsFor(filePath),
      );
      if (planned.edits.length === 0) {
        continue;
      }
      let content: string;
      try {
        content = await notes.contentOf(filePath);
      } catch (error) {
        return { kind: 'unopened', filePath, error };
      }
      if (content !== file.content) {
        return { kind: 'stale', filePath };
      }
      occurrenceCount += planned.occurrenceCount;
      files.push({ filePath, edits: planned.edits });
    }
    return { kind: 'planned', files, occurrenceCount };
  }

  /**
   * Reads the notes again, so search stops showing the old tag. A failure is
   * returned rather than thrown: the notes are already written.
   */
  private async refresh(): Promise<{ error: unknown } | undefined> {
    try {
      await this.collaborators.index.refresh();
      return undefined;
    } catch (error) {
      return { error };
    }
  }
}

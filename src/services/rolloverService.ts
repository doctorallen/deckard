import { NoteRange, planCarriedTasks } from '../domain/notes/carryForward';
import { formatLocalDate } from '../domain/notes/periodicNotes';
import { planRollover, RolloverMode, RolloverPlan } from '../domain/notes/rolloverPlan';
import type { WorkspaceIndex } from '../domain/model';
import type { Clock } from '../ports/clock';
import type { ResourceUri } from '../ports/uri';

/**
 * Carries yesterday's unfinished tasks into today's note.
 *
 * A daily note that starts empty every morning loses what was still open the
 * night before, so the tasks are written into today's note, under Carried
 * over, as they were written yesterday, metadata and all. Moving them takes
 * them out of the note they came from; migrating marks the line left behind
 * `[>]` with a link to today. The whole rollover is one write, so Undo Last
 * Change takes it back.
 */

/** A note a rollover draws from, once it is open. */
export interface RolloverSource<U extends ResourceUri> {
  uri: U;
  /** The note's text as it is now. */
  text(): string;
}

/** One change a rollover writes: `range` of the note becomes `text`. */
export interface RolloverEdit<U extends ResourceUri> {
  uri: U;
  range: NoteRange;
  text: string;
}

/** Whether a rollover's write landed, and the handle its Undo works through. */
export type RolloverWriteOutcome<Handle> = { applied: false } | { applied: true; handle: Handle };

/** The notes a rollover reads and writes. */
export interface RolloverNotes<U extends ResourceUri, Handle> {
  /** Today's note's text as it is now. */
  readToday(uri: U): Promise<string>;
  /** A note the plan draws from, by index path; undefined when it cannot be found or read. */
  openSource(filePath: string): Promise<RolloverSource<U> | undefined>;
  /** Writes every change as one write; `carried` is how many tasks it carries, for its label. */
  write(edits: readonly RolloverEdit<U>[], carried: number): Promise<RolloverWriteOutcome<Handle>>;
}

/**
 * Where the carried lines go in today's note: the stretch to replace, and
 * what replaces it. It shares capture's rule for where a line goes under a
 * heading, which lives with capture, so the service is handed it.
 */
export type PlaceCarriedOver = (content: string, lines: readonly string[]) => NoteRange & { text: string };

/** What RolloverService works through. */
export interface RolloverCollaborators<U extends ResourceUri, Handle> {
  notes: RolloverNotes<U, Handle>;
  place: PlaceCarriedOver;
  /** What reads the notes again once a rollover is written. */
  index: { refresh(): Promise<void> };
  clock: Clock;
}

/** One plan to carry into today's note. */
export interface RolloverRequest<U extends ResourceUri> {
  plan: RolloverPlan;
  todayUri: U;
  /** `copy`, the older name, is a migrate. */
  mode: Exclude<RolloverMode, 'off'> | 'copy';
  /** Today's note's name, which a migrated line links to; the file's name when absent. */
  todayName?: string;
}

/**
 * What carrying a plan came to. `nothing-carried` wrote nothing: every open
 * task was in today's note already, or had changed since it was indexed.
 */
export type RolloverOutcome<Handle> =
  | { kind: 'nothing-carried'; skipped: number; fromDates: string[] }
  | { kind: 'not-applied' }
  | {
      kind: 'carried';
      carried: number;
      /** Tasks left behind: already in today's note, or changed since indexing. */
      skipped: number;
      /** The days it drew from, oldest first. */
      fromDates: string[];
      /** How many notes it actually took tasks out of. */
      notes: number;
      handle: Handle;
    };

/** What rolling tasks forward came to, with today's note when a plan was carried. */
export type RollForwardResult<U extends ResourceUri, Handle> =
  | { kind: 'nothing-waiting' }
  | { kind: 'not-applied' }
  | (Exclude<RolloverOutcome<Handle>, { kind: 'not-applied' }> & { todayUri: U });

/** One Roll Tasks Forward: the index it plans from, and how. */
export interface RollForwardRequest<U extends ResourceUri> {
  index: WorkspaceIndex;
  mode: Exclude<RolloverMode, 'off'>;
  /** How far back it looks, in days; zero reaches as far as the notes. */
  lookbackDays: number;
  /** Today's note, created from its template when it is not there yet. */
  ensureToday: () => Promise<U>;
}

/**
 * Plans and writes rollovers. One is made where the extension starts; it
 * holds nothing between them.
 */
export class RolloverService<U extends ResourceUri, Handle> {
  /** Takes the notes it reads and writes, where carried lines go, the index, and the clock. */
  public constructor(private readonly collaborators: RolloverCollaborators<U, Handle>) {}

  /**
   * Carries the unfinished tasks of the earlier daily notes into today's,
   * creating today's note only when there is something to carry, and reads
   * the notes again once it is written.
   */
  public async rollForward(request: RollForwardRequest<U>): Promise<RollForwardResult<U, Handle>> {
    const plan = planRollover(
      request.index,
      formatLocalDate(new Date(this.collaborators.clock.now())),
      request.lookbackDays,
      request.mode,
    );
    if (!plan) {
      return { kind: 'nothing-waiting' };
    }
    const todayUri = await request.ensureToday();
    const result = await this.apply({
      plan,
      todayUri,
      mode: request.mode,
      todayName: todayUri.path.split('/').pop()?.replace(/\.md$/i, ''),
    });
    if (result.kind === 'not-applied') {
      return result;
    }
    try {
      await this.collaborators.index.refresh();
    } catch {
      // The watcher picks the notes up; the tasks themselves are written.
    }
    return { ...result, todayUri };
  }

  /**
   * Writes the plan's tasks into today's note, and takes them out of the
   * note they came from when moving, as one write. Each note the plan draws
   * from is read once.
   */
  public async apply(request: RolloverRequest<U>): Promise<RolloverOutcome<Handle>> {
    const { plan, todayUri, todayName } = request;
    const mode = request.mode === 'copy' ? 'migrate' : request.mode;
    const { notes, place } = this.collaborators;
    const todayText = await notes.readToday(todayUri);
    const sources = new Map<string, RolloverSource<U>>();
    for (const filePath of new Set(plan.tasks.map((task) => task.filePath))) {
      const source = await notes.openSource(filePath);
      if (source) {
        sources.set(filePath, source);
      }
    }

    const planned = planCarriedTasks(
      plan.tasks,
      new Map([...sources].map(([filePath, source]) => [filePath, source.text().split(/\r?\n/)])),
      todayText,
      { mode, target: todayName ?? todayUri.path.split('/').pop()?.replace(/\.md$/i, '') ?? '' },
    );
    if (planned.carried.length === 0) {
      return { kind: 'nothing-carried', skipped: planned.skipped, fromDates: plan.fromDates };
    }

    const placed = place(todayText, planned.lines);
    const edits: RolloverEdit<U>[] = [
      { uri: todayUri, range: { start: placed.start, end: placed.end }, text: placed.text },
      ...planned.sourceEdits.flatMap((edit) => {
        const source = sources.get(edit.filePath);
        return source ? [{ uri: source.uri, range: edit.range, text: edit.text }] : [];
      }),
    ];
    const written = await notes.write(edits, planned.carried.length);
    if (!written.applied) {
      return { kind: 'not-applied' };
    }
    return {
      kind: 'carried',
      carried: planned.carried.length,
      skipped: planned.skipped,
      fromDates: plan.fromDates,
      notes: planned.notes,
      handle: written.handle,
    };
  }
}

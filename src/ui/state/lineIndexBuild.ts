import { buildLineIndexSlice, type LineIndex, peekLineIndex } from '../../domain/ranking/lineIndex';
import type { WorkspaceIndex } from '../../domain/model';
import type { Event } from '../../ports/events';
import { Emitter } from '../../shared/emitter';
import { measureAsync } from '../../shared/timing';

/**
 * The line index Questions and Written before rank lines with, built off
 * the host's critical path: the first build reads every note, about two
 * seconds on 10,000 notes, so it runs a slice of notes at a time with the
 * host free between slices, and whatever asks for the lines meanwhile
 * shows nothing and redraws once `onDidBuildLineIndex` fires
 * (docs/implementation/38-questions.md, 39-written-before.md).
 */

/** How long one slice of the build may read notes before it yields. */
const SLICE_MS = 15;

const builtEmitter = new Emitter<void>();
/** Fires when the line index has been built for the index last asked for, so what showed nothing can redraw. */
export const onDidBuildLineIndex: Event<void> = builtEmitter.event;

/** The index the build under way is building toward; the newest asked for. */
let building: WorkspaceIndex | undefined;

/**
 * The line index of `index` when it is ready: built, and brought up to
 * `index` at once when few notes changed. Undefined while it is being
 * built, which this starts when it has not started.
 */
export function readLineIndex(index: WorkspaceIndex): LineIndex | undefined {
  const lines = peekLineIndex(index);
  if (lines) {
    return lines;
  }
  const started = building !== undefined;
  building = index;
  if (!started) {
    void measureAsync('Line index', buildInSlices, (notes) => `${notes} notes`).then(() => builtEmitter.fire());
  }
  return undefined;
}

/**
 * Reads the notes a slice at a time toward the newest index asked for,
 * yielding between slices, until the lines are that index's. Resolves with
 * how many notes it has.
 */
function buildInSlices(): Promise<number> {
  return new Promise((resolve) => {
    const slice = (): void => {
      const index = building;
      if (!index) {
        resolve(0);
        return;
      }
      const sliceStart = performance.now();
      const done = buildLineIndexSlice(index, () => performance.now() - sliceStart >= SLICE_MS);
      // A newer index asked for while this slice read is built toward next.
      if (!done || building !== index) {
        setTimeout(slice, 0);
        return;
      }
      building = undefined;
      resolve(index.files.size);
    };
    setTimeout(slice, 0);
  });
}

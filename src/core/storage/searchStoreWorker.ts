import { parentPort, workerData } from 'node:worker_threads';

import {
  NoteToWrite,
  openSearchDatabase,
  SearchWriter,
} from './searchDatabase';

/**
 * Writes the full-text cache on a thread of its own.
 *
 * The first build of a workspace writes every note, which took 155 ms at 940
 * notes and 1.4 s at 5,000 on the extension host — a host shared with every
 * other extension, and with every completion, hover, and CodeLens Deckard
 * itself answers. Here it costs nobody anything.
 *
 * The host stays the one that decides what to write, and splits each note
 * into its rows before sending it. Comparing a scan against the cache reads a
 * path, a time, and a size per note and is cheap; splitting a note is about
 * 3% of writing it. So a res››can that changed nothing sends nothing, and a
 * note is never parsed a second time or a second way.
 */

/** What the host sends this thread when it opens it. */
interface WorkerSetup {
  databasePath: string;
}

/** A batch to write, which the host numbers so it can be told it is done. */
export interface SearchWorkerRequest {
  id: number;
  write: NoteToWrite[];
  erase: string[];
  /** Empty the cache first, for a rebuild after the index drifted. */
  clear: boolean;
}

export type SearchWorkerReply =
  | { id: number; written: number }
  | { id: number; error: string };

/**
 * How many notes are written between commits.
 *
 * A commit is where the write lock is given up, so this is how long a save on
 * the extension host can wait behind a rebuild. Small enough that nobody
 * notices; large enough that a rebuild is not one transaction per note.
 */
const COMMIT_EVERY = 200;

const setup = workerData as WorkerSetup;
const writer = new SearchWriter(openSearchDatabase(setup.databasePath));

parentPort?.on('message', (request: SearchWorkerRequest) => {
  try {
    parentPort?.postMessage({ id: request.id, written: run(request) });
  } catch (error) {
    parentPort?.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

function run(request: SearchWorkerRequest): number {
  if (request.clear) {
    writer.transaction(() => writer.clear());
  }
  if (request.erase.length > 0) {
    writer.transaction(() =>
      request.erase.forEach((filePath) => writer.erase(filePath)),
    );
  }
  for (let start = 0; start < request.write.length; start += COMMIT_EVERY) {
    const batch = request.write.slice(start, start + COMMIT_EVERY);
    writer.transaction(() => batch.forEach((note) => writer.writeNote(note)));
  }
  return request.write.length;
}

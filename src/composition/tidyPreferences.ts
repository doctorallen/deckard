import type { PreferencesMaintenance } from '../core/storage/preferencesMaintenance';
import type { PreferencesRepository } from '../core/storage/preferencesRepository';
import { findChoiceFilePath } from '../core/storage/preferencesSchema';
import type { UsageService } from '../core/storage/preferencesUsage';
import { findRekeyedNotes, RekeyedNotes } from '../domain/index/folderRekey';
import type { FindChoice, PinnedNote, WorkspaceIndex } from '../domain/model';
import { carrySectionIds } from '../domain/ranking/frecency';

/** The preference services the tidy after an index update writes through. */
export interface TidyPreferences {
  repository: Pick<PreferencesRepository, 'current' | 'update'>;
  usage: Pick<UsageService, 'carrySectionAccess'>;
  maintenance: Pick<PreferencesMaintenance, 'prune'>;
}

/**
 * Keeps what Deckard derived about the notes in step with an index update,
 * from `previous` to `next`: what names a note whose path changed follows it
 * to the new path, a heading's view count follows it to its new id, and only
 * then is what names a note gone from the index pruned.
 *
 * A note's path changes when a second workspace folder is added or the
 * second removed, since a path then gains or loses the folder's key, and
 * every id in the note changes with it. Without carrying them first, the
 * prune took the note's task order, view counts, Find choices, and recent
 * headings, and left its pins naming nothing.
 */
export async function tidyAfterUpdate(
  previous: WorkspaceIndex,
  next: WorkspaceIndex,
  preferences: TidyPreferences,
): Promise<void> {
  const rekeyed = findRekeyedNotes(previous, next);
  const moved = carrySectionIds(previous, next);
  if (rekeyed.files.size > 0) {
    await carryRekeyedNotes(preferences, rekeyed);
  }
  if (moved.size > 0) {
    await preferences.usage.carrySectionAccess(moved);
  }
  await preferences.maintenance.prune(next);
}

/**
 * Moves what names a rekeyed note to its new path and ids: view counts and
 * times, task order, recent headings, pins, and Find choices.
 */
async function carryRekeyedNotes(preferences: TidyPreferences, rekeyed: RekeyedNotes): Promise<void> {
  await preferences.usage.carrySectionAccess(rekeyed.sections);
  const current = preferences.repository.current;
  const newPath = (filePath: string): string => rekeyed.files.get(filePath) ?? filePath;
  const carryPin = (pin: PinnedNote): PinnedNote => ({ ...pin, filePath: newPath(pin.filePath) });
  const carryChoice = (choice: FindChoice): FindChoice => ({
    ...choice,
    key: carryFindChoiceKey(choice.key, rekeyed.files),
  });
  await preferences.repository.update({
    taskOrder: current.taskOrder.map((taskId) => rekeyed.tasks.get(taskId) ?? taskId),
    ...(current.recentHeadings ? { recentHeadings: current.recentHeadings.map(carryPin) } : {}),
    ...(current.pinnedNotes ? { pinnedNotes: current.pinnedNotes.map(carryPin) } : {}),
    ...(current.findChoices ? { findChoices: current.findChoices.map(carryChoice) } : {}),
  });
}

/**
 * A Find choice's key with the note it names at its new path. The key is a
 * kind, a colon, and a JSON list whose first item is the note's path; a key
 * that names no rekeyed note is kept as it is.
 */
function carryFindChoiceKey(key: string, files: ReadonlyMap<string, string>): string {
  const filePath = findChoiceFilePath(key);
  const moved = filePath === undefined ? undefined : files.get(filePath);
  if (moved === undefined) {
    return key;
  }
  const kind = key.slice(0, key.indexOf(':') + 1);
  const parts = JSON.parse(key.slice(kind.length)) as unknown[];
  return `${kind}${JSON.stringify([moved, ...parts.slice(1)])}`;
}

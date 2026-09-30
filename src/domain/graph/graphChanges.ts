/**
 * Whether a new index could draw a different notes graph, so a save that
 * only changes words inside a line leaves the graph alone rather than
 * rebuilding it.
 */
import { extractWikiLinks } from '../markdown/parser';
import { ParsedFile, WorkspaceIndex } from '../model';

/**
 * Everything the graph reads from one note, as one string: its entries'
 * ids, headings, lines, nesting, tags and their spellings, and links, and
 * the note's own front-matter tags, links, and aliases. Two versions of a
 * note with the same signature draw the same graph, which is what lets a
 * save that only changes words inside a line leave the graph alone.
 *
 * A field the graph (or the tag counts and associations it draws from)
 * starts reading must join this, and the list in notes-graph-state.test.ts
 * that proves the signature covers what the graph reads.
 */
export function graphSignature(file: ParsedFile): string {
  const cached = signatures.get(file);
  if (cached !== undefined) {
    return cached;
  }
  const references = (tags: readonly { key: string; label: string }[] | undefined) =>
    (tags ?? []).map((tag) => [tag.key, tag.label]);
  const signature = JSON.stringify([
    file.sections.length,
    references(file.frontmatterTags),
    file.links,
    file.aliases ?? [],
    file.sections.map((section) => [
      section.id,
      section.heading,
      section.headingLevel,
      section.isInline === true,
      section.startLine,
      section.parentSectionId ?? '',
      section.tags,
      section.tagLabels,
      references(section.bodyTags),
      references(section.headingTags),
      (section.associationTagGroups ?? []).map(references),
      section.links,
    ]),
    file.tasks.map((task) => [
      task.id,
      task.title,
      task.lineNumber,
      task.sectionId ?? '',
      task.tags,
      task.tagLabels,
      (task.associationTagGroups ?? []).map(references),
      extractWikiLinks(task.sourceLineText),
    ]),
  ]);
  signatures.set(file, signature);
  return signature;
}

const signatures = new WeakMap<ParsedFile, string>();

/**
 * Whether the graph drawn from `after` could differ from the one drawn from
 * `before`: a note came, went, or moved in the order, or a note that changed
 * changed something the graph draws. A note that was not saved keeps its
 * parsed object from one index to the next, so only saved notes are compared.
 */
export function graphInputsChanged(
  before: WorkspaceIndex | undefined,
  after: WorkspaceIndex,
): boolean {
  if (!before) {
    return true;
  }
  if (before === after) {
    return false;
  }
  if (before.files.size !== after.files.size) {
    return true;
  }
  const previous = before.files.entries();
  for (const [filePath, file] of after.files) {
    const next = previous.next();
    if (next.done) {
      return true;
    }
    const [previousPath, previousFile] = next.value;
    if (previousPath !== filePath) {
      return true;
    }
    if (previousFile !== file && graphSignature(previousFile) !== graphSignature(file)) {
      return true;
    }
  }
  // Parking is a setting, not part of a note: a change to it redraws the
  // graph without any note changing.
  return !sameParking(before.parked, after.parked);
}

/** Whether two indexes park the same things. */
function sameParking(
  before: WorkspaceIndex['parked'],
  after: WorkspaceIndex['parked'],
): boolean {
  const sets = (state: WorkspaceIndex['parked']) =>
    state ? [state.files, state.sections, state.tasks, state.tags] : [];
  const left = sets(before);
  const right = sets(after);
  const empty = (list: Set<string>[]) => list.every((set) => set.size === 0);
  if (left.length === 0 || right.length === 0) {
    return empty(left) && empty(right);
  }
  return left.every(
    (set, at) => set.size === right[at].size && [...set].every((value) => right[at].has(value)),
  );
}

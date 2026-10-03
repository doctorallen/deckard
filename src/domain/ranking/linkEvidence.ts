/**
 * The Wiki-link evidence between the note being read and a candidate entry:
 * a link from one straight to the other counts most, and a link between the
 * two notes at all counts a little.
 */
import { stripTags } from '../markdown/parser';
import { ParsedFile } from '../model';

/** The note being ranked against: its parse, and its path when it has one. */
export interface ActiveNote {
  file: ParsedFile;
  filePath: string | undefined;
}

/** A candidate entry: the note it is in, the links it writes, and its title. */
export interface CandidateEntry {
  file: ParsedFile;
  links: string[];
  title: string;
}

/** What links add to an entry's score: to the entry itself, or to its note. */
export interface LinkEvidence {
  entryWeight: number;
  fileWeight: number;
}

/** The names a link can use for a note, from its path and its aliases. */
export type LinkNames = (filePath: string, aliases?: readonly string[]) => Set<string>;

/**
 * How strongly links join a candidate to the note being read: half a point
 * when either links straight to the other's entry, a tenth when the two
 * notes link to each other at all, and nothing otherwise.
 */
export function getLinkEvidence(
  linkNames: LinkNames,
  active: ActiveNote,
  candidate: CandidateEntry,
): LinkEvidence {
  const activeFile = active.file;
  const candidateFile = candidate.file;
  const activeEntryTitle =
    activeFile.sections[0]?.heading ?? activeFile.tasks[0]?.title;
  const candidateMatchesActive = candidate.links.some((link) =>
    activeEntryTitle !== undefined &&
    linkTargetsEntry(linkNames, link, {
      filePath: active.filePath ?? activeFile.filePath,
      title: activeEntryTitle,
      aliases: activeFile.aliases,
    }),
  );
  const activeMatchesCandidate = activeFile.links.some((link) =>
    linkTargetsEntry(linkNames, link, {
      filePath: candidateFile.filePath,
      title: candidate.title,
      aliases: candidateFile.aliases,
    }),
  );
  if (candidateMatchesActive || activeMatchesCandidate) {
    return { entryWeight: 0.5, fileWeight: 0 };
  }
  return filesAreLinked(linkNames, activeFile, candidateFile)
    ? { entryWeight: 0, fileWeight: 0.1 }
    : { entryWeight: 0, fileWeight: 0 };
}

/** Whether either note links to the other, by any name the other goes by. */
function filesAreLinked(linkNames: LinkNames, left: ParsedFile, right: ParsedFile): boolean {
  const leftNames = linkNames(left.filePath, left.aliases);
  const rightNames = linkNames(right.filePath, right.aliases);
  return (
    left.links.some((link) => rightNames.has(getLinkFileTarget(link))) ||
    right.links.some((link) => leftNames.has(getLinkFileTarget(link)))
  );
}

/**
 * Whether a link opens an entry: it names the entry's note, and either no
 * heading or the entry's own title, as headings are compared.
 */
function linkTargetsEntry(
  linkNames: LinkNames,
  link: string,
  { filePath, title, aliases }: { filePath: string; title: string; aliases?: readonly string[] },
): boolean {
  const [fileTarget, headingTarget] = link.split('#', 2);
  if (!linkNames(filePath, aliases).has(normalizeLink(fileTarget))) {
    return false;
  }
  return !headingTarget || normalizeHeadingTarget(headingTarget) ===
    normalizeHeadingTarget(title);
}

/**
 * The names a link can use for a note, by path. Ranking asks for them for
 * every entry it scores, so each ranking works each path's names out once,
 * and forgets them when it is done.
 */
export function createLinkNames(): LinkNames {
  const byPath = new Map<string, Set<string>>();
  return (filePath, aliases) => {
    let names = byPath.get(filePath);
    if (!names) {
      const fileName = filePath.split('/').pop() ?? filePath;
      names = new Set([
        normalizeLink(filePath),
        normalizeLink(fileName),
        normalizeLink(fileName.replace(/\.md$/i, '')),
      ]);
      byPath.set(filePath, names);
    }
    // Aliases can change without the path changing, so they are not cached.
    return aliases?.length
      ? new Set([...names, ...aliases.map(normalizeLink)])
      : names;
  };
}

/** The note a link names, without its `#Heading`, as names are compared. */
function getLinkFileTarget(link: string): string {
  return normalizeLink(link.split('#', 1)[0]);
}

/** A note name as links are compared: trimmed, without `.md`, lowercased. */
function normalizeLink(value: string): string {
  return value.trim().replace(/\.md$/i, '').toLocaleLowerCase();
}

/**
 * A heading as a link's `#Heading` is compared with an entry's title:
 * without tags or case, each run of other characters one space.
 */
function normalizeHeadingTarget(value: string): string {
  return stripTags(value)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

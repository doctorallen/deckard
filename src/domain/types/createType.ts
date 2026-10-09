/**
 * Create Type from Tags, apart from VS Code: the rows a type could be made
 * of, and a guess at each field those rows' notes already write
 * (docs/implementation/30-databases.md § Surfaces 1).
 *
 * The guess reads the values as written: tags of one namespace are a
 * relation to that namespace's type (people are Person), ISO dates a Date,
 * numbers a Number, links and addresses a Link or Email, a few short values
 * used again and again a Select, and anything else Text.
 */
import { formatKeyWords, readTagNamespace } from '../markdown/tagKeys';
import type { FrontmatterValue, ParsedFile, WorkspaceIndex } from '../model';
import { readNumberValue } from './fieldValues';
import { isBuiltInFieldName, type TypeRegistry } from './typeRegistry';

/** What a type could be made of: the tags of a namespace, the people, or the notes with one `type:`. */
export interface RowSource {
  kind: 'namespace' | 'people' | 'notes';
  /** The key the type would get: `team`, `person`, `incident`. */
  key: string;
  /** Its display name: `Team`, `Person`, `Incident`. */
  name: string;
  /** `rows:` as the type note will write it: `#team/*`, `@*`, `notes`. */
  rows: string;
  /** How many tags would be rows; 0 for notes. */
  tagCount: number;
  /** How many notes hold rows' fields: hub notes for tags, the notes themselves for `type:`. */
  noteCount: number;
  /** The notes whose front matter the fields are guessed from, by path. */
  filePaths: string[];
}

/** Keys that say what a note is rather than what it holds, never offered as fields. */
const IDENTITY_KEYS = new Set(['describes', 'type', 'deckard-type', 'tags', 'tag', 'aliases', 'alias']);

/**
 * What a type could be made of, as Create Type from Tags offers it: each
 * tag namespace with no type yet, the most used first; the people, when no
 * type has them; then each `type:` value no type names, with how many notes
 * write it.
 */
export function listRowSources(index: WorkspaceIndex, registry: TypeRegistry): RowSource[] {
  const namespaces = new Map<string, { tags: number; hubs: Set<string> }>();
  const people = { tags: 0, hubs: new Set<string>() };
  index.tags.forEach((tag) => {
    const hub = tag.hubFilePaths?.find((path) => index.files.has(path));
    const key = tag.key.toLowerCase();
    if (key.startsWith('@') || key.startsWith('#person/')) {
      people.tags += 1;
      if (hub) {
        people.hubs.add(hub);
      }
      return;
    }
    const namespace = readTagNamespace(key);
    if (!namespace || registry.forTag(key)) {
      return;
    }
    const found = namespaces.get(namespace) ?? { tags: 0, hubs: new Set<string>() };
    found.tags += 1;
    if (hub) {
      found.hubs.add(hub);
    }
    namespaces.set(namespace, found);
  });

  const sources: RowSource[] = [...namespaces]
    .sort(([leftName, left], [rightName, right]) => right.tags - left.tags || leftName.localeCompare(rightName))
    .map(([namespace, found]) => ({
      kind: 'namespace',
      key: namespace,
      name: formatKeyWords(namespace.split('/').pop() ?? namespace),
      rows: `#${namespace}/*`,
      tagCount: found.tags,
      noteCount: found.hubs.size,
      filePaths: [...found.hubs],
    }));
  if (people.tags > 0 && !registry.tagTypes.some((type) => type.rows?.kind === 'tags' && type.rows.prefix === '@')) {
    sources.push({
      kind: 'people',
      key: 'person',
      name: 'Person',
      rows: '@*',
      tagCount: people.tags,
      noteCount: people.hubs.size,
      filePaths: [...people.hubs],
    });
  }

  const typed = new Map<string, { written: string; paths: string[] }>();
  index.files.forEach((file, filePath) => {
    const written = file.typeKey?.trim();
    if (!written || registry.get(written)) {
      return;
    }
    const key = written.toLowerCase();
    const found = typed.get(key) ?? { written, paths: [] };
    found.paths.push(filePath);
    typed.set(key, found);
  });
  [...typed.values()]
    .sort((left, right) => right.paths.length - left.paths.length || left.written.localeCompare(right.written))
    .forEach(({ written, paths }) => {
      const key = slugKey(written);
      if (!key) {
        return;
      }
      sources.push({
        kind: 'notes',
        key,
        name: formatKeyWords(key),
        rows: 'notes',
        tagCount: 0,
        noteCount: paths.length,
        filePaths: paths,
      });
    });
  return sources;
}

/** A field Create Type found in the rows' notes, with the kind it guessed. */
export interface FieldGuess {
  /** The field's name as the type note will write it; a built-in's name gets the type's key before it. */
  name: string;
  /** The front-matter key the notes write it as. */
  key: string;
  /** The `Kind` cell it guessed: `Person`, `Area, many`, `Select: gold, silver`. */
  kind: string;
  /** The `Reverse` cell, for a relation: `lead of`. */
  reverse?: string;
  /** How many of the rows' notes write it, of how many. */
  count: number;
  total: number;
  /** Set when the name is a built-in query field's, so the field is written under another. */
  renamedFrom?: string;
  /** Tags among its values from namespaces the kind leaves out, with how many of each: `#system/`. */
  otherNamespaces?: Array<{ prefix: string; count: number }>;
}

/**
 * The fields the rows' notes write, the most used first, each with a
 * guessed kind. A key that says what the note is, such as `describes:` or
 * `type:`, is left out.
 */
export function guessTypeFields(
  files: readonly ParsedFile[],
  options: { typeKey: string; registry: TypeRegistry },
): FieldGuess[] {
  const byKey = new Map<string, { count: number; values: FrontmatterValue[][] }>();
  files.forEach((file) => {
    file.properties?.forEach((property) => {
      const key = property.name.toLowerCase();
      if (IDENTITY_KEYS.has(key) || !/^[a-z][a-z0-9_-]*$/.test(key)) {
        return;
      }
      const found = byKey.get(key) ?? { count: 0, values: [] };
      found.count += 1;
      found.values.push(property.values.filter((value) => value.text.trim() !== ''));
      byKey.set(key, found);
    });
  });
  return [...byKey]
    .sort(([, left], [, right]) => right.count - left.count)
    .map(([key, found]) => {
      const guess = guessFieldKind(found.values, options.registry);
      const builtIn = isBuiltInFieldName(key);
      const name = builtIn ? `${options.typeKey}-${key}` : key;
      return {
        name,
        key,
        kind: guess.kind,
        ...(guess.relation ? { reverse: `${name} of` } : {}),
        count: found.count,
        total: files.length,
        ...(builtIn ? { renamedFrom: key } : {}),
        ...(guess.otherNamespaces ? { otherNamespaces: guess.otherNamespaces } : {}),
      };
    });
}

/** A kind guessed from a field's values. */
export interface KindGuess {
  /** The `Kind` cell. */
  kind: string;
  /** Whether it names rows, and so has a reverse. */
  relation: boolean;
  otherNamespaces?: Array<{ prefix: string; count: number }>;
}

/** A field's values that read as a Date: ISO days, with or without a time. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const URL = /^https?:\/\/\S+$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINK = /^\[\[[^\]]+\]\]$/;
/** The most options a Select is guessed with, and the longest an option is. */
const SELECT_OPTIONS = 6;
const SELECT_OPTION_LENGTH = 24;

/**
 * A field's kind, from its values in each note that writes it: `, many`
 * when a note writes more than one.
 */
export function guessFieldKind(valuesByNote: readonly (readonly FrontmatterValue[])[], registry: TypeRegistry): KindGuess {
  const values = valuesByNote.flat();
  const many = valuesByNote.some((values) => values.length > 1) ? ', many' : '';
  const texts = values.map((value) => value.text.trim());
  if (values.length === 0) {
    return { kind: 'Text', relation: false };
  }
  const tagged = values.filter((value) => value.tag);
  if (tagged.length > 0 && tagged.length * 2 >= values.length) {
    const relation = guessRelation(tagged, registry);
    return { ...relation, kind: `${relation.kind}${many}` };
  }
  const every = (test: (text: string) => boolean): boolean => texts.every(test);
  if (every((text) => LINK.test(text))) {
    return { kind: `Note${many}`, relation: true };
  }
  if (every((text) => ISO_DAY.test(text))) {
    return { kind: `Date${many}`, relation: false };
  }
  if (every((text) => readNumberValue(text) !== undefined)) {
    return { kind: `Number${many}`, relation: false };
  }
  if (every((text) => /^(?:true|false)$/i.test(text))) {
    return { kind: 'Checkbox', relation: false };
  }
  if (every((text) => URL.test(text))) {
    return { kind: `Link${many}`, relation: false };
  }
  if (every((text) => EMAIL.test(text))) {
    return { kind: `Email${many}`, relation: false };
  }
  const options = readSelectOptions(texts);
  if (options) {
    return { kind: `Select: ${options.join(', ')}`, relation: false };
  }
  return { kind: `Text${many}`, relation: false };
}

/**
 * A relation to the namespace most of the tags are in: Person for people,
 * a type's display name when one has the namespace, or the namespace
 * worded (`Area`), which a quick fix offers to make a type of.
 */
function guessRelation(tagged: readonly FrontmatterValue[], registry: TypeRegistry): KindGuess {
  const counts = new Map<string, number>();
  tagged.forEach((value) => {
    const key = value.tag?.key.toLowerCase() ?? '';
    const prefix = key.startsWith('@') || key.startsWith('#person/') ? '@' : `#${readTagNamespace(key) ?? ''}/`;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  });
  const ranked = [...counts].sort(([leftPrefix, left], [rightPrefix, right]) => right - left || leftPrefix.localeCompare(rightPrefix));
  const [prefix] = ranked[0];
  const others = ranked.slice(1).map(([other, count]) => ({ prefix: other, count }));
  let kind: string;
  if (prefix === '@') {
    kind = 'Person';
  } else if (prefix === '#/') {
    kind = 'Text';
  } else {
    const namespace = prefix.slice(1, -1);
    kind = registry.forTag(`${prefix}x`)?.name ?? formatKeyWords(namespace.split('/').pop() ?? namespace);
  }
  return { kind, relation: kind !== 'Text', ...(others.length > 0 ? { otherNamespaces: others } : {}) };
}

/**
 * A Select's options, in the order first written and as first spelled:
 * at most six distinct short values, at least one written in two notes.
 * Undefined when the values read as free text.
 */
function readSelectOptions(texts: readonly string[]): string[] | undefined {
  const options = new Map<string, string>();
  texts.forEach((text) => {
    if (!options.has(text.toLowerCase())) {
      options.set(text.toLowerCase(), text);
    }
  });
  const short = [...options.values()].every((option) => option.length <= SELECT_OPTION_LENGTH && !option.includes(','));
  return options.size <= SELECT_OPTIONS && options.size < texts.length && short ? [...options.values()] : undefined;
}

/**
 * How a guessed field reads in Create Type's list: its kind, how many rows
 * write it, and its reverse, `Person · 5 of 5 · reverse: lead of`; and the
 * detail lines for a field renamed from a built-in's name, and for tags of
 * another namespace among its values.
 */
export function describeFieldGuess(guess: FieldGuess): { description: string; detail?: string } {
  const description = [guess.kind, `${guess.count} of ${guess.total}`, ...(guess.reverse ? [`reverse: ${guess.reverse}`] : [])].join(' · ');
  const details: string[] = [];
  if (guess.renamedFrom) {
    details.push(`${guess.renamedFrom} is a built-in query field, so this is ${guess.name}; rename ${guess.renamedFrom}: in the notes to fill it.`);
  }
  guess.otherNamespaces?.forEach(({ prefix, count }) => {
    details.push(`${count} ${count === 1 ? 'value is a' : 'values are'} ${prefix === '@' ? 'person' : `${prefix}`} ${count === 1 ? 'tag' : 'tags'}.`);
  });
  return { description, ...(details.length > 0 ? { detail: details.join(' ') } : {}) };
}

/**
 * How a row source reads in Create Type's list: `#team · 6 tags · 5 hub
 * notes`, `@ people · 12 people · 4 hub notes`, `type: incident · 7 notes`.
 */
export function describeRowSource(source: RowSource): { label: string; description: string } {
  const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
  if (source.kind === 'notes') {
    return { label: `type: ${source.key}`, description: plural(source.noteCount, 'note', 'notes') };
  }
  const hubs = plural(source.noteCount, 'hub note', 'hub notes');
  if (source.kind === 'people') {
    return { label: '@ people', description: `${plural(source.tagCount, 'person', 'people')} · ${hubs}` };
  }
  return { label: `#${source.key}`, description: `${plural(source.tagCount, 'tag', 'tags')} · ${hubs}` };
}

/**
 * The folder most of the rows' notes are in, as `notes:` names it, `Teams/`,
 * when every one is in the same folder below the notes folder; undefined
 * otherwise, so the type's rows go to its plural name's folder.
 */
export function guessNotesFolder(filePaths: readonly string[]): string | undefined {
  const folders = new Set(filePaths.map((path) => path.slice(0, Math.max(path.lastIndexOf('/'), 0))));
  const [only] = folders;
  return folders.size === 1 && only ? `${only}/` : undefined;
}

/** A `type:` value as a type's key: lowercased, each run of other characters a hyphen. */
function slugKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}


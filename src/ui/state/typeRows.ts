/**
 * A typed row as the editor names it: what Deckard writes for it in front
 * matter, the line a completion or a quick fix describes it with, the
 * prefix the hub lens gives it, and the rows closest to a value that names
 * none (docs/implementation/30-databases.md § Surfaces 2).
 */
import { noteTitle } from '../../domain/index/backlinks';
import { formatKeyWords } from '../../domain/markdown/tagKeys';
import { isWithinDistance } from '../../domain/ranking/tagHygiene';
import type { FieldKind, ParsedFile, WorkspaceIndex } from '../../domain/model';
import { isRowKind } from '../../domain/types/fieldKinds';
import { rowIdOfTag, type RowField, type TypeIndex, type TypeRow } from '../../domain/types/typeIndex';
import type { TypeDefinition, TypeRegistry } from '../../domain/types/typeRegistry';

/** A row a field's value can name, as a completion or a quick fix offers it. */
export interface RowChoice {
  /** The row's id: `@omar`, `#team/credit-trading`, `file:Incidents/RFQ outage.md`. */
  id: string;
  title: string;
  /** What Deckard writes for it: `"@omar"`, `"#team/credit-trading"`, `"[[RFQ outage]]"`. */
  written: string;
  /** Its type's display name, `Person`. */
  typeName: string;
  /** Its type and first relation: `Team · lead Omar Haddad`. */
  detail: string;
  /** The other names a value can give it: its slug, tag, and aliases, lowercased. */
  names: string[];
}

/**
 * What Deckard writes for a row in front matter: a person's tag, `"@omar"`;
 * a namespace row's tag, as written, `"#team/credit-trading"`; a note
 * row's link, `"[[RFQ outage]]"`. Quoted, since YAML reads a bare `#` as a
 * comment and cannot start a plain value with `@` or `[`.
 */
export function writeRowValue(row: Pick<TypeRow, 'id' | 'label' | 'tagKeys' | 'title'>): string {
  if (row.tagKeys.length === 0) {
    return `"[[${row.title}]]"`;
  }
  if (row.id.startsWith('@')) {
    return `"${row.id}"`;
  }
  const label = row.label && row.label.toLowerCase() === row.id ? row.label : row.id;
  return `"${label}"`;
}

/** A row's first relation that holds a value: the field's name, and the title of the row its first value names. */
export function findFirstRelation(types: TypeIndex, rowId: string): { name: string; title: string } | undefined {
  const field = types
    .fields(rowId)
    .find((candidate) => candidate.field && candidate.source !== 'reverse' && isRowKind(candidate.kind) && candidate.values.length > 0);
  const value = field?.values[0];
  if (!field || !value) {
    return undefined;
  }
  return { name: field.name, title: valueTitle(types, value) };
}

/** The title a value is read as: the row's or note's it names, else its text. */
export function valueTitle(types: TypeIndex, value: RowField['values'][number]): string {
  if (value.rowId) {
    return types.row(value.rowId)?.title ?? value.text;
  }
  return value.notePath ? noteTitle(value.notePath) : value.text;
}

/** How a completion or quick fix describes a row: its type and first relation, `Team · lead Omar Haddad`. */
export function describeRowDetail(types: TypeIndex, row: TypeRow): string {
  const name = types.registry.get(row.typeKey)?.name ?? formatKeyWords(row.typeKey);
  const relation = findFirstRelation(types, row.id);
  return relation ? `${name} · ${relation.name} ${relation.title}` : name;
}

/**
 * What the hub lens on a row's note starts with: its type and its first
 * relation's value, `Person · Credit Trading`, or its type alone.
 */
export function describeRowLensPrefix(types: TypeIndex, row: TypeRow): string {
  const name = types.registry.get(row.typeKey)?.name ?? formatKeyWords(row.typeKey);
  const relation = findFirstRelation(types, row.id);
  return relation ? `${name} · ${relation.title}` : name;
}

/** A row as a completion or quick fix offers it. */
export function toRowChoice(types: TypeIndex, row: TypeRow): RowChoice {
  const slug = row.id.replace(/^[#@]/, '').split('/').pop() ?? row.id;
  return {
    id: row.id,
    title: row.title,
    written: writeRowValue(row),
    typeName: types.registry.get(row.typeKey)?.name ?? formatKeyWords(row.typeKey),
    detail: describeRowDetail(types, row),
    names: [...new Set([row.id, ...row.tagKeys, slug, ...row.aliases].map((name) => name.toLowerCase()))],
  };
}

/**
 * The rows a person or relation field can name: the rows of each type it
 * takes, and, when it takes people, every person, whether or not a type has
 * them. A Note field names any note, and is left to `[[` completion.
 */
export function listKindRows(types: TypeIndex, index: WorkspaceIndex, kind: FieldKind): RowChoice[] {
  if (kind.name !== 'person' && kind.name !== 'relation') {
    return [];
  }
  const choices = new Map<string, RowChoice>();
  (kind.targets ?? []).forEach((key) => {
    types.rows(key).forEach((row) => {
      if (!row.implicit) {
        choices.set(row.id, toRowChoice(types, row));
      }
    });
  });
  if (kind.name === 'person' || kind.people) {
    index.tags.forEach((tag) => {
      const key = tag.key.toLowerCase();
      const id = rowIdOfTag(key);
      if (!id.startsWith('@') || choices.has(id)) {
        return;
      }
      const row = types.rowOfTag(key);
      if (row) {
        choices.set(row.id, toRowChoice(types, row));
        return;
      }
      const hub = tag.hubFilePaths?.find((path) => index.files.has(path));
      const slug = id.slice(1);
      choices.set(id, {
        id,
        title: hub ? noteTitle(hub) : formatKeyWords(slug),
        written: `"${id}"`,
        typeName: 'Person',
        detail: 'Person',
        names: [id, key, slug],
      });
    });
  }
  return [...choices.values()].sort((left, right) => left.title.localeCompare(right.title));
}

/** A value as it is compared with a row's names: lowercased, with no quotes, marker, or `[[ ]]`. */
function normalize(text: string): string {
  return text
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^\[\[|\]\]$/g, '')
    .replace(/^@/, '')
    .replace(/^#?person\//i, '')
    .toLowerCase();
}

/**
 * Whether a choice's names hold a value being typed: its title, a word of
 * its title, or one of its names starts with it, any case. An empty value
 * holds every choice.
 */
export function matchesRowChoice(choice: RowChoice, typed: string): boolean {
  const query = normalize(typed).replace(/^#/, '');
  if (!query) {
    return true;
  }
  const title = choice.title.toLowerCase();
  return (
    title.startsWith(query) ||
    title.split(/\s+/).some((word) => word.startsWith(query)) ||
    choice.names.some((name) => name.replace(/^[#@]/, '').startsWith(query) || (name.split('/').pop() ?? '').startsWith(query))
  );
}

/**
 * The choices closest to a value that names none, best first, at most
 * `limit`: those a name or title starts with the value or the other way
 * round, or whose words each start with the value's words (`Omar H` for
 * Omar Haddad); then those a typo or two away.
 */
export function findClosestRows(choices: readonly RowChoice[], value: string, limit = 3): RowChoice[] {
  const query = normalize(value);
  const bare = query.replace(/^#[^/]*\//, '');
  if (!bare) {
    return [];
  }
  const scored = choices.flatMap((choice) => {
    const score = scoreChoice(choice, bare);
    return score > 0 ? [{ choice, score }] : [];
  });
  return scored
    .sort((left, right) => right.score - left.score || left.choice.title.localeCompare(right.choice.title))
    .slice(0, limit)
    .map(({ choice }) => choice);
}

/** How close a choice is to a value: 2 for a prefix or word match, 1 for a typo, 0 for neither. */
function scoreChoice(choice: RowChoice, query: string): number {
  const names = [choice.title.toLowerCase(), ...choice.names.map((name) => name.replace(/^[#@]/, '').split('/').pop() ?? name)];
  const words = query.split(/[\s-]+/).filter(Boolean);
  const prefix = names.some((name) => {
    if (query.length >= 2 && (name.startsWith(query) || (name.length >= 2 && query.startsWith(name)))) {
      return true;
    }
    const nameWords = name.split(/[\s-]+/).filter(Boolean);
    return words.length > 1 && words.length <= nameWords.length && words.every((word, at) => nameWords[at].startsWith(word));
  });
  if (prefix) {
    return 2;
  }
  const allowed = Math.max(1, Math.floor(query.length / 4));
  return names.some((name) => isWithinDistance(name, query, allowed)) ? 1 : 0;
}

/**
 * The types a note is a row of, from its front matter as written now: the
 * note type its `type:` names, then the namespace type of each tag its
 * `describes:` names, each once, in key order, as the type index reads a
 * field two of them define.
 */
export function findRowTypes(registry: TypeRegistry, file: Pick<ParsedFile, 'typeKey' | 'hub'>): TypeDefinition[] {
  const types = new Map<string, TypeDefinition>();
  const noteType = file.typeKey ? registry.forTypeValue(file.typeKey) : undefined;
  if (noteType) {
    types.set(noteType.key, noteType);
  }
  file.hub?.describes.forEach((tag) => {
    const type = registry.forTag(tag.key);
    if (type) {
      types.set(type.key, type);
    }
  });
  return [...types.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * The rows a note holds, as its first-line lens leads with them: each
 * row's tag or type, and its prefix, `Person · Credit Trading`. Empty in a
 * workspace with no types.
 */
export function describeNoteRows(
  types: TypeIndex,
  filePath: string,
): Array<{ id: string; tagKeys: string[]; typeKey: string; label?: string; prefix: string; typeName: string }> {
  if (types.isEmpty) {
    return [];
  }
  return types.rowsOfFile(filePath).map((row) => ({
    id: row.id,
    tagKeys: row.tagKeys,
    typeKey: row.typeKey,
    ...(row.tagKeys.length > 0 ? { label: row.id.startsWith('@') ? row.id : row.label ?? row.id } : {}),
    prefix: describeRowLensPrefix(types, row),
    typeName: types.registry.get(row.typeKey)?.name ?? formatKeyWords(row.typeKey),
  }));
}

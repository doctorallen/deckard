/**
 * The rows of every type and what their fields hold, read from one index
 * (docs/implementation/30-databases.md § Rows, § Values, § Computed fields).
 *
 * - A type whose `rows:` is a namespace has a row for every tag under it,
 *   whether or not a hub note describes it; the hub's front matter holds its
 *   fields. A nested tag is a row with a computed `parent`, and a level
 *   with no tag of its own is a row too, so the tree has no gaps. `@dana`
 *   and `#person/dana` are one row, `@dana`.
 * - A type whose `rows:` is `notes` has a row for every note whose `type:`
 *   names it.
 * - A value is read by its field's kind. One that names a row is resolved
 *   from a tag, a slug, a title, or an alias, with or without its namespace,
 *   or from a `[[link]]` or bare title for a note; one that resolves to
 *   nothing is kept as text and listed as a problem.
 * - Each relation's reverse is computed on the rows it names. When a row
 *   writes a field its reverse also fills, the two merge; a one-value field
 *   given two is a problem.
 *
 * The index is built from a snapshot of the workspace index the first time
 * it is asked for, and shared by every caller of that snapshot (see
 * {@link getTypeIndex}); a change to the notes makes a new snapshot, and so
 * a new type index. A workspace with no types builds nothing. What depends
 * on the clock, the computed fields, is worked out when asked.
 */
import { createNoteTitleMap, getBacklinkIndex, noteTitle, parseWikiTarget, resolveWikiTarget } from '../index/backlinks';
import { addDays, formatIsoDate, startOfDay } from '../markdown/calendar';
import { fileEntryId } from '../markdown/noteEntries';
import { formatKeyWords } from '../markdown/tagKeys';
import type {
  FieldKind,
  FrontmatterValue,
  ParsedFile,
  Section,
  Task,
  TypeField,
  TypeProblem,
  WorkspaceIndex,
} from '../model';
import {
  isComputedFieldName,
  isRowKind,
  reverseNameOf,
  sameKind,
  toFieldQueryName,
  type ComputedFieldName,
} from './fieldKinds';
import {
  describeKindName,
  readCheckboxValue,
  readDateValue,
  readNumberValue,
  readSelectValue,
} from './fieldValues';
import { buildTypeRegistry, type TypeDefinition, type TypeRegistry } from './typeRegistry';

/** How many fields a path reads at most: two relations, then a field (`owned-by.lead.email`). */
export const MAX_PATH_SEGMENTS = 3;

/** How far back `mentions` counts entries. */
export const MENTION_DAYS = 30;

/** One row of a type: a tag of its namespace, or a note whose `type:` names it. */
export interface TypeRow {
  /**
   * The row's id: its tag's key for a tag row (`#team/rates`; `@dana` for a
   * person, however written), or `file:<path>` for a note row, the id the
   * index gives a note's front-matter entry.
   */
  id: string;
  typeKey: string;
  /** The row's title: its note's, or its hub note's, or its tag's name worded (`Bond Trading`). */
  title: string;
  /** A tag row's tag as written, `@dana`. */
  label?: string;
  /** The tags that are this row: `@dana` and `#person/dana`. Empty for a note row. */
  tagKeys: string[];
  /** The note whose front matter holds the row's fields: its hub note, or the row's note. */
  filePath?: string;
  /** Other names its note goes by, from `aliases:`. */
  aliases: string[];
  /** The row a nested tag row is under, by id. */
  parentId?: string;
  /** Set on a namespace level that is no tag of its own, as `#team/rates` is when only `#team/rates/emea` is written. */
  implicit?: true;
}

/** One value of a row's field, as read by its kind. */
export interface FieldValue {
  /** The value as written, or, for a reverse or computed one, the row's or note's title. */
  text: string;
  /** Where it is written: the note and one-based line. Absent for a computed value. */
  filePath?: string;
  line?: number;
  /** The row it names, by id: a person, a relation, a note row, or a reverse's row. */
  rowId?: string;
  /** The note it names, by path: a Note field's, or a note row's. */
  notePath?: string;
  number?: number;
  /** A date, `YYYY-MM-DD`. */
  date?: string;
  checked?: boolean;
  /** A select's option as the schema spells it. */
  option?: string;
  /** Set when the value names nothing its kind can read; it is kept as text. */
  unresolved?: true;
  /** For a reverse's value: the row and field that wrote it. */
  via?: { rowId: string; field: string };
}

/** One field of a row, with its values. */
export interface RowField {
  /** The name as the schema writes it, or the reverse's or computed field's name. */
  name: string;
  /** The name as a query writes it: `owned-by`. */
  queryName: string;
  kind: FieldKind;
  /**
   * Where the values come from: the row's note (`written`), other rows'
   * relations (`reverse`), both (`merged`), or the notes (`computed`).
   */
  source: 'written' | 'reverse' | 'merged' | 'computed';
  /** The schema's field, for a field the row's type defines. */
  field?: TypeField;
  values: FieldValue[];
}

/** A row's computed fields at one moment. */
export interface ComputedFields {
  /** Open tasks the row's tag finds, or its note holds; steps, cancelled, and parked tasks aside. */
  openTasks: number;
  /** Of those, how many are past their due date. */
  overdue: number;
  /** When the latest entry that mentions the row's tag, or links to its note, was updated. */
  lastMentioned?: number;
  /** How many such entries were updated in the last {@link MENTION_DAYS} days. */
  mentions: number;
  /** The notes that link to a note row, by path. */
  linkedFrom: string[];
  parent?: string;
  children: string[];
}

/** A value a path ends at, with the rows it went through to get there, by id. */
export interface PathValue extends FieldValue {
  trail: string[];
}

/** The rows of every type of one index, their fields, and what is wrong with their values. */
export class TypeIndex {
  /** Every row, by id. */
  private readonly rowsById = new Map<string, TypeRow>();
  /** Each type's rows, in the order found: tags in index order, then notes in index order. */
  private readonly rowsByType = new Map<string, TypeRow[]>();
  /** Each note's rows: those whose fields it holds. */
  private readonly rowsByFile = new Map<string, TypeRow[]>();
  /** Each type's rows by every name a loose value can give them, lowercased. */
  private readonly namesByType = new Map<string, Map<string, string>>();
  /** People by every name a loose value can give them, whether or not a type has them as rows. */
  private readonly peopleNames = new Map<string, string>();
  /** Each row's children, by id. */
  private readonly childrenById = new Map<string, string[]>();
  /** Each row's written fields, by front-matter key. */
  private readonly written = new Map<string, Map<string, RowField>>();
  /** The reverse values each row is named by, by reverse query name, with the name as written. */
  private readonly reverses = new Map<string, Map<string, { name: string; kind: FieldKind; values: FieldValue[] }>>();
  /** Each row's fields, written and reverse merged, worked out when first asked for. */
  private readonly merged = new Map<string, RowField[]>();
  /** Each row's tasks, worked out the first time a computed field is asked for. */
  private tasksByRow: Map<string, Task[]> | undefined;
  private readonly valueProblems: TypeProblem[] = [];
  private mergeChecked = false;

  /** Reads the rows and their written values; reverses and computed fields wait until asked for. */
  public constructor(
    private readonly index: WorkspaceIndex,
    public readonly registry: TypeRegistry = buildTypeRegistry(index.typeNotes?.values() ?? []),
  ) {
    if (registry.size === 0) {
      return;
    }
    this.findTagRows();
    this.findNoteRows();
    this.collectNames();
    this.readWrittenFields();
    this.collectReverses();
  }

  /** Whether the workspace defines no type. */
  public get isEmpty(): boolean {
    return this.registry.size === 0;
  }

  /** Every row, or a type's rows by its key or display name. */
  public rows(typeKey?: string): TypeRow[] {
    if (typeKey === undefined) {
      return [...this.rowsById.values()];
    }
    const type = this.registry.get(typeKey);
    return type ? [...(this.rowsByType.get(type.key) ?? [])] : [];
  }

  /** The row with this id. */
  public row(id: string): TypeRow | undefined {
    return this.rowsById.get(id);
  }

  /** The row a tag is, if a type has it: `#person/dana` finds `@dana`. */
  public rowOfTag(tagKey: string): TypeRow | undefined {
    return this.rowsById.get(rowIdOfTag(tagKey));
  }

  /** The rows whose fields a note holds: the tags it is the hub of, and itself as a note row. */
  public rowsOfFile(filePath: string): TypeRow[] {
    return [...(this.rowsByFile.get(filePath) ?? [])];
  }

  /** The type of a row, by the row's id. */
  public typeOf(rowId: string): TypeDefinition | undefined {
    const row = this.rowsById.get(rowId);
    return row ? this.registry.get(row.typeKey) : undefined;
  }

  /**
   * Rows whose title, alias, tag, or slug is this text, any case, of every
   * type; a namespace row matches its name with or without the namespace.
   */
  public findRows(text: string): TypeRow[] {
    const found = new Set<string>();
    this.registry.types.forEach((type) => {
      const id = this.lookupInType(type, text);
      if (id) {
        found.add(id);
      }
    });
    return [...found].flatMap((id) => this.rowsById.get(id) ?? []);
  }

  /**
   * A row's fields: its type's, in the table's order, each with what its
   * note writes merged with what other rows' relations say of it, empty
   * ones included; then the reverses its type does not write.
   */
  public fields(rowId: string): RowField[] {
    this.checkMerges();
    return [...(this.merged.get(rowId) ?? this.mergeFields(rowId))];
  }

  /**
   * One field of a row by name: a schema field by its name (`field.status`
   * reaches one a built-in's name hides), a reverse by its name or query
   * name, or a computed field, worked out at `now`.
   */
  public field(rowId: string, name: string, now: number = Date.now()): RowField | undefined {
    const schemaOnly = /^field\./i.test(name);
    const wanted = toFieldQueryName(schemaOnly ? name.slice('field.'.length) : name);
    const fields = this.fields(rowId);
    const found =
      fields.find((field) => field.field && toFieldQueryName(field.field.name) === wanted) ??
      (schemaOnly ? undefined : fields.find((field) => field.queryName === wanted));
    if (found || schemaOnly || !isComputedFieldName(wanted)) {
      return found;
    }
    return this.computedField(rowId, wanted, now);
  }

  /**
   * The values at the end of a path such as `team.lead` or `owned-by.lead`:
   * each segment a field of every row the one before named, at most
   * {@link MAX_PATH_SEGMENTS}. Empty for a longer path or a name no row has.
   */
  public path(rowId: string, path: string | readonly string[], now: number = Date.now()): PathValue[] {
    const segments = typeof path === 'string' ? splitFieldPath(path) : [...path];
    if (segments.length === 0 || segments.length > MAX_PATH_SEGMENTS) {
      return [];
    }
    let current: Array<{ rowId: string; trail: string[] }> = [{ rowId, trail: [] }];
    for (let at = 0; at < segments.length; at += 1) {
      const values = current.flatMap(({ rowId: from, trail }) =>
        (this.field(from, segments[at], now)?.values ?? []).map((value) => ({ value, trail })),
      );
      if (at === segments.length - 1) {
        return dedupeValues(values.map(({ value, trail }) => ({ ...value, trail })));
      }
      const next = new Map<string, string[]>();
      values.forEach(({ value, trail }) => {
        if (value.rowId && !next.has(value.rowId)) {
          next.set(value.rowId, [...trail, value.rowId]);
        }
      });
      current = [...next].map(([id, trail]) => ({ rowId: id, trail }));
    }
    return [];
  }

  /** A row's computed fields at `now`. */
  public computed(rowId: string, now: number = Date.now()): ComputedFields {
    const row = this.rowsById.get(rowId);
    const tasks = this.getTasksByRow().get(rowId) ?? [];
    const today = startOfDay(now);
    let openTasks = 0;
    let overdue = 0;
    tasks.forEach((task) => {
      if (task.completed || task.status.type === 'cancelled') {
        return;
      }
      openTasks += 1;
      if (task.dueAt !== undefined && task.dueAt < today) {
        overdue += 1;
      }
    });
    const mentions = row ? this.findMentions(row) : [];
    const since = addDays(today, -MENTION_DAYS);
    const lastMentioned = mentions.reduce<number | undefined>(
      (latest, at) => (at !== undefined && (latest === undefined || at > latest) ? at : latest),
      undefined,
    );
    return {
      openTasks,
      overdue,
      ...(lastMentioned === undefined ? {} : { lastMentioned }),
      mentions: mentions.filter((at) => at !== undefined && at >= since).length,
      linkedFrom: row && !row.tagKeys.length && row.filePath ? this.linkingNotes(row.filePath) : [],
      ...(row?.parentId ? { parent: row.parentId } : {}),
      children: [...(this.childrenById.get(rowId) ?? [])],
    };
  }

  /**
   * Every problem: the type notes', and the rows' values that name nothing,
   * do not fit their kind, or disagree with a reverse, by path and line.
   */
  public get problems(): TypeProblem[] {
    this.checkMerges();
    return [...this.registry.problems, ...this.valueProblems].sort(
      (left, right) => left.filePath.localeCompare(right.filePath) || left.line - right.line,
    );
  }

  /** The problems in one note: a type note's, or a row note's values. */
  public problemsIn(filePath: string): TypeProblem[] {
    return this.problems.filter((problem) => problem.filePath === filePath);
  }

  /**
   * Reads one value as a field of this kind would: what a query, a
   * completion, or a page reads a loose value by. `filePath` is the note it
   * is written in, which a relative link and a date in words are read from.
   */
  public resolveValue(kind: FieldKind, value: string | FrontmatterValue, filePath?: string): FieldValue {
    const written: FrontmatterValue = typeof value === 'string' ? { text: value } : value;
    const file = filePath ? this.index.files.get(filePath) : undefined;
    return this.readValue(kind, written, filePath, file?.updatedAt ?? this.index.updatedAt);
  }

  // Building ---------------------------------------------------------------

  /** A row for every tag a namespace type has, and every level above a nested one. */
  private findTagRows(): void {
    if (this.registry.tagTypes.length === 0) {
      return;
    }
    this.index.tags.forEach((tag) => {
      const type = this.registry.forTag(tag.key);
      if (!type || type.rows?.kind !== 'tags') {
        return;
      }
      const id = rowIdOfTag(tag.key);
      const row = this.rowsById.get(id) ?? this.addTagRow(type, id, tag.label);
      if (!row.tagKeys.includes(tag.key)) {
        row.tagKeys.push(tag.key);
      }
      if (id === tag.key) {
        row.label = tag.label;
      }
    });
    // Hubs, titles, and parents once every tag is in.
    this.rowsById.forEach((row) => {
      const hubPath = [row.id, ...row.tagKeys]
        .map((key) => this.index.tags.get(key)?.hubFilePaths?.[0])
        .find((path): path is string => path !== undefined && this.index.files.has(path));
      if (!hubPath) {
        return;
      }
      row.filePath = hubPath;
      row.title = noteTitle(hubPath);
      row.aliases = [...(this.index.files.get(hubPath)?.aliases ?? [])];
      this.addFileRow(hubPath, row);
    });
    [...this.rowsById.values()].forEach((row) => this.linkParent(row));
  }

  /** Adds a tag row, worded from its tag until a hub note names it. */
  private addTagRow(type: TypeDefinition, id: string, label: string, implicit = false): TypeRow {
    const row: TypeRow = {
      id,
      typeKey: type.key,
      title: formatKeyWords(lastSegment(id)),
      label,
      tagKeys: [],
      aliases: [],
      ...(implicit ? { implicit: true as const } : {}),
    };
    this.rowsById.set(id, row);
    const rows = this.rowsByType.get(type.key);
    if (rows) {
      rows.push(row);
    } else {
      this.rowsByType.set(type.key, [row]);
    }
    return row;
  }

  /** Sets a nested row's parent, adding the level above as a row when no tag is written for it. */
  private linkParent(row: TypeRow): void {
    const type = this.registry.get(row.typeKey);
    const prefix = type?.rows?.kind === 'tags' ? type.rows.prefix : undefined;
    if (!type || !prefix) {
      return;
    }
    const rest = row.id.slice(prefix.length);
    const cut = rest.lastIndexOf('/');
    if (cut <= 0) {
      return;
    }
    const parentId = `${prefix}${rest.slice(0, cut)}`;
    let parent = this.rowsById.get(parentId);
    if (!parent) {
      parent = this.addTagRow(type, parentId, parentId, true);
      this.linkParent(parent);
    }
    row.parentId = parentId;
    const children = this.childrenById.get(parentId);
    if (children) {
      children.push(row.id);
    } else {
      this.childrenById.set(parentId, [row.id]);
    }
  }

  /** A row for every note whose `type:` names a note type. */
  private findNoteRows(): void {
    if (this.registry.noteTypes.length === 0) {
      return;
    }
    this.index.files.forEach((file, filePath) => {
      const type = file.typeKey ? this.registry.forTypeValue(file.typeKey) : undefined;
      if (!type) {
        return;
      }
      const row: TypeRow = {
        id: fileEntryId(filePath),
        typeKey: type.key,
        title: noteTitle(filePath),
        tagKeys: [],
        filePath,
        aliases: [...(file.aliases ?? [])],
      };
      this.rowsById.set(row.id, row);
      const rows = this.rowsByType.get(type.key);
      if (rows) {
        rows.push(row);
      } else {
        this.rowsByType.set(type.key, [row]);
      }
      this.addFileRow(filePath, row);
    });
  }

  /** Notes that a note holds a row's fields. */
  private addFileRow(filePath: string, row: TypeRow): void {
    const rows = this.rowsByFile.get(filePath);
    if (rows) {
      rows.push(row);
    } else {
      this.rowsByFile.set(filePath, [row]);
    }
  }

  /**
   * The names a loose value can give each row: its id, its slug with and
   * without the namespace, its title, and its aliases, lowercased; and the
   * same for every person, typed or not. The first row to take a name keeps it.
   */
  private collectNames(): void {
    this.rowsByType.forEach((rows, typeKey) => {
      const names = new Map<string, string>();
      const type = this.registry.get(typeKey);
      const prefix = type?.rows?.kind === 'tags' ? type.rows.prefix : undefined;
      rows.forEach((row) => {
        const add = (name: string | undefined): void => {
          const key = name?.trim().toLowerCase();
          if (key && !names.has(key)) {
            names.set(key, row.id);
          }
        };
        add(row.id);
        row.tagKeys.forEach(add);
        if (prefix) {
          add(row.id.slice(prefix.length));
        }
        add(row.title);
        row.aliases.forEach(add);
        add(row.filePath && !row.tagKeys.length ? noteTitle(row.filePath) : undefined);
      });
      // A nested row's last part names it too, when no other row takes it.
      if (prefix) {
        rows.forEach((row) => {
          const last = lastSegment(row.id).toLowerCase();
          if (!names.has(last)) {
            names.set(last, row.id);
          }
        });
      }
      this.namesByType.set(typeKey, names);
    });
    this.index.tags.forEach((tag) => {
      const id = personRowId(tag.key);
      if (!id) {
        return;
      }
      const row = this.rowsById.get(id);
      [id, tag.key, id.slice(1), row?.title, ...(row?.aliases ?? [])].forEach((name) => {
        const key = name?.trim().toLowerCase();
        if (key && !this.peopleNames.has(key)) {
          this.peopleNames.set(key, id);
        }
      });
    });
  }

  /**
   * Reads every row's fields from its note, by its type's schema. Where a
   * note holds rows of two types that define one field differently, the
   * first type by key reads it for both, and the note gets a problem.
   */
  private readWrittenFields(): void {
    this.rowsByFile.forEach((rows, filePath) => {
      const file = this.index.files.get(filePath);
      if (!file) {
        return;
      }
      const schemas = this.schemasOfFile(file, rows);
      rows.forEach((row) => {
        const type = this.registry.get(row.typeKey);
        if (!type) {
          return;
        }
        const fields = new Map<string, RowField>();
        type.fields.forEach((field) => {
          const reading = schemas.get(field.key) ?? field;
          const property = file.properties?.find((candidate) => candidate.name === field.key);
          const values = this.readValues(reading, property?.values ?? [], filePath, file.updatedAt);
          fields.set(field.key, {
            name: field.name,
            queryName: toFieldQueryName(field.name),
            kind: reading.kind,
            source: 'written',
            field,
            values,
          });
        });
        this.written.set(row.id, fields);
      });
    });
  }

  /**
   * The field each front-matter key of a note is read as: the first type's
   * by key, of the types whose rows the note holds, with a problem where
   * another defines it with a different kind.
   */
  private schemasOfFile(file: ParsedFile, rows: readonly TypeRow[]): Map<string, TypeField> {
    const schemas = new Map<string, TypeField>();
    const owners = new Map<string, string>();
    const types = [...new Set(rows.map((row) => row.typeKey))]
      .sort()
      .flatMap((key) => this.registry.get(key) ?? []);
    types.forEach((type) => {
      type.fields.forEach((field) => {
        const first = schemas.get(field.key);
        if (!first) {
          schemas.set(field.key, field);
          owners.set(field.key, type.name);
          return;
        }
        if (sameKind(first.kind, field.kind)) {
          return;
        }
        const property = file.properties?.find((candidate) => candidate.name === field.key);
        this.valueProblems.push({
          code: 'field-kinds-differ',
          message: `${owners.get(field.key)} and ${type.name} both define ${field.name}, as ${first.kindText || 'Text'} and ${field.kindText || 'Text'}; it is read as ${owners.get(field.key)}'s.`,
          filePath: file.filePath,
          line: property?.line ?? 1,
          field: field.key,
        });
      });
    });
    return schemas;
  }

  /** A field's values as written, each read by its kind, with a problem for each that names nothing. */
  private readValues(
    field: TypeField,
    written: readonly FrontmatterValue[],
    filePath: string,
    anchor: number | undefined,
  ): FieldValue[] {
    const kind = field.kind;
    const pieces = written.filter((value) => value.text.trim() !== '');
    // `owns: rates, credit` is two values when the field holds several.
    const values =
      kind.many && pieces.length === 1 && (isRowKind(kind) || kind.name === 'select') && !pieces[0].tag
        ? splitLooseList(pieces[0])
        : pieces;
    return values.map((value) => {
      const read = this.readValue(kind, value, filePath, anchor ?? this.index.updatedAt);
      if (read.unresolved) {
        this.valueProblems.push(this.describeUnresolved(field, read, filePath));
      }
      return read;
    });
  }

  /** One value read by its kind. */
  private readValue(kind: FieldKind, value: FrontmatterValue, filePath: string | undefined, anchor: number): FieldValue {
    const text = value.text.trim();
    const base: FieldValue = {
      text,
      ...(filePath ? { filePath } : {}),
      ...(value.line ? { line: value.line } : {}),
    };
    switch (kind.name) {
      case 'number': {
        const number = readNumberValue(text);
        return number === undefined ? { ...base, unresolved: true } : { ...base, number };
      }
      case 'date': {
        const date = readDateValue(text, anchor);
        return date === undefined ? { ...base, unresolved: true } : { ...base, date };
      }
      case 'checkbox': {
        const checked = readCheckboxValue(text);
        return checked === undefined ? { ...base, unresolved: true } : { ...base, checked };
      }
      case 'select': {
        const option = readSelectValue(kind, text);
        return option === undefined ? { ...base, unresolved: true } : { ...base, option };
      }
      case 'person':
      case 'relation':
      case 'note': {
        const found = this.resolveRowValue(kind, value, filePath);
        return found ? { ...base, ...found } : { ...base, unresolved: true };
      }
      case 'text':
      case 'link':
      case 'email':
      case 'phone':
        return base;
    }
  }

  /**
   * The row, or note, a value names, for a person, relation, or Note field:
   * its tag as written; for each type the field takes, its slug, title, or
   * alias, with or without the namespace; for a note, a `[[link]]` or a
   * bare title.
   */
  private resolveRowValue(
    kind: FieldKind,
    value: FrontmatterValue,
    filePath: string | undefined,
  ): Pick<FieldValue, 'rowId' | 'notePath'> | undefined {
    const text = value.text.trim();
    const link = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(text);
    const name = link ? link[1] : text;
    if (kind.name === 'note') {
      return this.resolveNoteValue(name, filePath);
    }
    const targets = (kind.targets ?? []).flatMap((key) => this.registry.get(key) ?? []);
    const people = kind.name === 'person' || kind.people === true;
    const tagged = link ? undefined : this.resolveTagValue(value, targets, people);
    if (tagged) {
      return { rowId: tagged };
    }
    for (const type of targets) {
      const found = this.resolveInType(type, name, Boolean(link), filePath);
      if (found) {
        return found;
      }
    }
    const person = people && !link ? this.lookupPerson(text) : undefined;
    return person ? { rowId: person } : undefined;
  }

  /** The note a Note field's link or title opens, and its row when it is one. */
  private resolveNoteValue(name: string, filePath: string | undefined): Pick<FieldValue, 'rowId' | 'notePath'> | undefined {
    const notePath = this.resolveNote(name, filePath);
    if (!notePath) {
      return undefined;
    }
    const rowId = fileEntryId(notePath);
    return this.rowsById.has(rowId) ? { notePath, rowId } : { notePath };
  }

  /** The row a value written as a tag is, when it is a row the field takes. */
  private resolveTagValue(value: FrontmatterValue, targets: readonly TypeDefinition[], people: boolean): string | undefined {
    if (!value.tag) {
      return undefined;
    }
    const id = rowIdOfTag(value.tag.key);
    const typeKey = this.rowsById.get(id)?.typeKey;
    return (people && personRowId(value.tag.key)) || targets.some((type) => type.key === typeKey) ? id : undefined;
  }

  /** The row of one type a loose value or a link's name names: a note row by its note, a tag row by its names. */
  private resolveInType(
    type: TypeDefinition,
    name: string,
    isLink: boolean,
    filePath: string | undefined,
  ): Pick<FieldValue, 'rowId' | 'notePath'> | undefined {
    if (type.rows?.kind === 'notes') {
      const notePath = this.resolveNote(name, filePath);
      const rowId = notePath ? fileEntryId(notePath) : undefined;
      return notePath && rowId && this.rowsById.get(rowId)?.typeKey === type.key ? { rowId, notePath } : undefined;
    }
    const rowId = isLink ? undefined : this.lookupInType(type, name);
    return rowId ? { rowId } : undefined;
  }

  /** The row of a namespace or note type a loose value names, by id. */
  private lookupInType(type: TypeDefinition, text: string): string | undefined {
    const names = this.namesByType.get(type.key);
    if (!names) {
      return undefined;
    }
    const trimmed = text.trim();
    const candidates = [trimmed];
    const prefix = type.rows?.kind === 'tags' ? type.rows.prefix : undefined;
    if (prefix === '@') {
      const bare = trimmed.replace(/^@/, '').replace(/^#?person\//i, '');
      candidates.push(bare, `@${slugPath(bare)}`);
    } else if (prefix) {
      const namespace = prefix.slice(1, -1).toLowerCase();
      let bare = trimmed.replace(/^#/, '');
      if (bare.toLowerCase().startsWith(`${namespace}/`)) {
        bare = bare.slice(namespace.length + 1);
      }
      candidates.push(bare, slugPath(bare), `${prefix}${slugPath(bare)}`);
    }
    for (const candidate of candidates) {
      const id = names.get(candidate.toLowerCase());
      if (id) {
        return id;
      }
    }
    return undefined;
  }

  /** A person a loose value names, by id: `dana`, `@dana`, `person/dana`, `Dana Whitfield`. */
  private lookupPerson(text: string): string | undefined {
    const trimmed = text.trim();
    const bare = trimmed.replace(/^@/, '').replace(/^#?person\//i, '');
    for (const candidate of [trimmed, bare, `@${slugPath(bare)}`]) {
      const id = this.peopleNames.get(candidate.toLowerCase());
      if (id) {
        return id;
      }
    }
    return undefined;
  }

  /** The note a link's name or a bare title opens, when exactly one does. */
  private resolveNote(name: string, filePath: string | undefined): string | undefined {
    const target = parseWikiTarget(name);
    return target.note
      ? resolveWikiTarget(createNoteTitleMap(this.index), target.note, filePath ?? '')
      : undefined;
  }

  /** What is wrong with a value its kind cannot read, as a problem at its line. */
  private describeUnresolved(field: TypeField, value: FieldValue, filePath: string): TypeProblem {
    const kind = field.kind;
    const relation = kind.name === 'person' || kind.name === 'relation' || kind.name === 'note';
    let message: string;
    if (kind.name === 'select') {
      message = `"${value.text}" is not an option of ${field.name}: ${listWords(kind.options ?? [])}.`;
    } else if (relation) {
      message = `No ${this.describeTargets(kind)} is named "${value.text}" yet.`;
    } else {
      message = `${field.name} is a ${describeKindName(kind)} field, and "${value.text}" is not a ${kind.name}.`;
    }
    return {
      code: relation || kind.name === 'select' ? 'unresolved-value' : 'kind-mismatch',
      message,
      filePath,
      line: value.line ?? 1,
      field: field.key,
      value: value.text,
    };
  }

  /** What a relation's rows are called, lowercased: `person`, `area or system`, `note`. */
  private describeTargets(kind: FieldKind): string {
    if (kind.name === 'note') {
      return 'note';
    }
    const names = [
      ...(kind.name === 'person' || kind.people ? ['person'] : []),
      ...(kind.targets ?? []).map((key) => (this.registry.get(key)?.name ?? key).toLowerCase()),
    ];
    return [...new Set(names)].join(' or ') || 'row';
  }

  /** What every row's relations say of the rows they name, by each relation's reverse. */
  private collectReverses(): void {
    this.written.forEach((fields, rowId) => {
      const row = this.rowsById.get(rowId);
      if (!row) {
        return;
      }
      fields.forEach((rowField) => {
        const field = rowField.field;
        if (!field || !isRowKind(rowField.kind)) {
          return;
        }
        const name = reverseNameOf(field);
        const queryName = toFieldQueryName(name);
        rowField.values.forEach((value) => {
          if (!value.rowId || value.rowId === rowId) {
            return;
          }
          let byName = this.reverses.get(value.rowId);
          if (!byName) {
            byName = new Map();
            this.reverses.set(value.rowId, byName);
          }
          let reverse = byName.get(queryName);
          if (!reverse) {
            reverse = { name, kind: { name: 'relation', many: true, targets: [row.typeKey] }, values: [] };
            byName.set(queryName, reverse);
          }
          if (!reverse.values.some((existing) => existing.rowId === rowId)) {
            reverse.values.push({
              text: row.title,
              rowId,
              ...(value.filePath ? { filePath: value.filePath } : {}),
              ...(value.line ? { line: value.line } : {}),
              via: { rowId, field: field.name },
            });
          }
        });
      });
    });
  }

  /** Merges every row's fields once, so their conflicts are among the problems. */
  private checkMerges(): void {
    if (this.mergeChecked) {
      return;
    }
    this.mergeChecked = true;
    new Set([...this.rowsById.keys(), ...this.reverses.keys()]).forEach((rowId) => this.mergeFields(rowId));
  }

  /**
   * A row's written fields with the reverses that fill them merged in, and
   * then the reverses no written field takes. A field that holds one value
   * and is given several is a problem.
   */
  private mergeFields(rowId: string): RowField[] {
    const cached = this.merged.get(rowId);
    if (cached) {
      return cached;
    }
    const written = this.written.get(rowId) ?? new Map<string, RowField>();
    const reverses = new Map(this.reverses.get(rowId) ?? []);
    const fields: RowField[] = [];
    written.forEach((rowField) => {
      const reverse = reverses.get(rowField.queryName);
      if (!reverse || !isRowKind(rowField.kind)) {
        fields.push(rowField);
        return;
      }
      reverses.delete(rowField.queryName);
      const values = [...rowField.values];
      reverse.values.forEach((value) => {
        if (!values.some((existing) => existing.rowId === value.rowId)) {
          values.push(value);
        }
      });
      const mergedField: RowField = { ...rowField, source: 'merged', values };
      fields.push(mergedField);
      this.checkConflict(rowId, mergedField);
    });
    reverses.forEach((reverse, queryName) => {
      fields.push({ name: reverse.name, queryName, kind: reverse.kind, source: 'reverse', values: reverse.values });
    });
    this.merged.set(rowId, fields);
    return fields;
  }

  /** A problem when a field that holds one value is given more by a reverse. */
  private checkConflict(rowId: string, rowField: RowField): void {
    const rows = new Set(rowField.values.map((value) => value.rowId).filter(Boolean));
    if (rowField.kind.many || rows.size <= 1) {
      return;
    }
    const row = this.rowsById.get(rowId);
    const named = rowField.values.map((value) =>
      value.via
        ? `${value.text} (its ${value.via.field})`
        : `${this.rowsById.get(value.rowId ?? '')?.title ?? value.text} (written here)`,
    );
    this.valueProblems.push({
      code: 'relation-conflict',
      message: `${rowField.name} holds one value, but ${row?.title ?? rowId} is given ${rows.size}: ${listWords(named)}.`,
      ...this.conflictPlace(row, rowField),
      field: rowField.field?.key ?? rowField.queryName,
    });
  }

  /**
   * Where a conflict is shown: at the value the row's note writes; else at
   * the field's key in the row's note, or its first line; else, for a row
   * with no note, at the first reverse's value.
   */
  private conflictPlace(row: TypeRow | undefined, rowField: RowField): { filePath: string; line: number } {
    const written = rowField.values.find((value) => !value.via && value.filePath);
    if (written?.filePath) {
      return { filePath: written.filePath, line: written.line ?? 1 };
    }
    if (row?.filePath) {
      const key = rowField.field?.key;
      const property = this.index.files.get(row.filePath)?.properties?.find((candidate) => candidate.name === key);
      return { filePath: row.filePath, line: property?.line ?? 1 };
    }
    const reverse = rowField.values.find((value) => value.via);
    return { filePath: reverse?.filePath ?? '', line: reverse?.line ?? 1 };
  }

  /** A computed field as a field: its name, its kind, and its value at `now`. */
  private computedField(rowId: string, name: ComputedFieldName, now: number): RowField | undefined {
    if (!this.rowsById.has(rowId)) {
      return undefined;
    }
    const computed = this.computed(rowId, now);
    const field = (kind: FieldKind, values: FieldValue[]): RowField => ({
      name,
      queryName: name,
      kind,
      source: 'computed',
      values,
    });
    const rowValue = (id: string): FieldValue => ({ text: this.rowsById.get(id)?.title ?? id, rowId: id });
    switch (name) {
      case 'open-tasks':
        return field({ name: 'number', many: false }, [{ text: String(computed.openTasks), number: computed.openTasks }]);
      case 'mentions':
        return field({ name: 'number', many: false }, [{ text: String(computed.mentions), number: computed.mentions }]);
      case 'last-mentioned': {
        const at = computed.lastMentioned;
        const date = at === undefined ? undefined : formatIsoDate(at);
        return field({ name: 'date', many: false }, date ? [{ text: date, date }] : []);
      }
      case 'linked-from':
        return field(
          { name: 'note', many: true },
          computed.linkedFrom.map((path) => ({
            text: noteTitle(path),
            notePath: path,
            ...(this.rowsById.has(fileEntryId(path)) ? { rowId: fileEntryId(path) } : {}),
          })),
        );
      case 'parent':
        return field({ name: 'relation', many: false, targets: [this.rowsById.get(rowId)?.typeKey ?? ''] }, computed.parent ? [rowValue(computed.parent)] : []);
      case 'children':
        return field({ name: 'relation', many: true, targets: [this.rowsById.get(rowId)?.typeKey ?? ''] }, computed.children.map(rowValue));
    }
  }

  /**
   * Each row's tasks: for a tag row, those a search for its tags finds (on
   * the task, its heading, a heading above, or its note's front matter);
   * for a note row, the note's own. Steps and parked tasks aside.
   */
  private getTasksByRow(): Map<string, Task[]> {
    if (this.tasksByRow) {
      return this.tasksByRow;
    }
    const byRow = new Map<string, Task[]>();
    const add = (rowId: string, task: Task): void => {
      const tasks = byRow.get(rowId);
      if (tasks) {
        tasks.push(task);
      } else {
        byRow.set(rowId, [task]);
      }
    };
    const counted = (task: Task): boolean => !task.parentTaskId && !this.index.parked?.tasks.has(task.id);
    if (this.registry.tagTypes.length > 0) {
      this.index.tasks.forEach((task) => {
        if (!counted(task)) {
          return;
        }
        const rows = new Set<string>();
        readTaskTagKeys(this.index, task).forEach((key) => {
          const id = rowIdOfTag(key);
          if (this.rowsById.get(id)?.tagKeys.length) {
            rows.add(id);
          }
        });
        rows.forEach((id) => add(id, task));
      });
    }
    this.rowsById.forEach((row) => {
      if (!row.tagKeys.length && row.filePath) {
        this.index.files.get(row.filePath)?.tasks.filter(counted).forEach((task) => add(row.id, task));
      }
    });
    this.tasksByRow = byRow;
    return byRow;
  }

  /**
   * When each entry that mentions a row was updated: for a tag row, the
   * entries its tags find, its hub note's aside; for a note row, the
   * entries that link to it. One time per entry, undefined when unknown.
   */
  private findMentions(row: TypeRow): Array<number | undefined> {
    const times = new Map<string, number | undefined>();
    if (row.tagKeys.length > 0) {
      const tagged = new Set<string>();
      const tasks: Task[] = [];
      row.tagKeys.forEach((key) => {
        const tag = this.index.tags.get(key);
        tag?.sectionIds.forEach((id) => {
          const section = this.index.sections.get(id);
          if (!section || section.filePath === row.filePath) {
            return;
          }
          tagged.add(id);
          times.set(id, section.updatedAt);
        });
        tag?.filePaths.forEach((path) => {
          if (path === row.filePath) {
            return;
          }
          tagged.add(fileEntryId(path));
          times.set(fileEntryId(path), this.index.files.get(path)?.updatedAt);
        });
        tag?.taskIds.forEach((id) => {
          const task = this.index.tasks.get(id);
          if (task && task.filePath !== row.filePath) {
            tasks.push(task);
          }
        });
      });
      // A task inside a tagged entry is that entry's mention, as a tag's count reads it.
      tasks.forEach((task) => {
        const owner = task.entryId ?? task.sectionId;
        if (!owner || !tagged.has(owner)) {
          times.set(task.id, task.updatedAt);
        }
      });
      return [...times.values()];
    }
    if (row.filePath) {
      getBacklinkIndex(this.index)
        .toNote(row.filePath)
        .forEach((link) => {
          const source = this.index.files.get(link.sourcePath);
          const section = source ? entryAtLine(source, link.line) : undefined;
          if (section) {
            times.set(section.id, section.updatedAt);
          } else {
            times.set(fileEntryId(link.sourcePath), source?.updatedAt);
          }
        });
    }
    return [...times.values()];
  }

  /** The notes that link to a note, by path, each once, in the order found. */
  private linkingNotes(filePath: string): string[] {
    return [...new Set(getBacklinkIndex(this.index).toNote(filePath).map((link) => link.sourcePath))];
  }
}

/** The type index of each workspace index, built the first time it is asked for. */
const typeIndexes = new WeakMap<WorkspaceIndex, TypeIndex>();

/**
 * The type index of one workspace index, built once and shared by every
 * surface that reads types: queries, the editor, Find, pages, and the
 * assistant's tools. A new index after a change to the notes makes a new
 * one; a workspace with no types costs one empty registry.
 */
export function getTypeIndex(index: WorkspaceIndex): TypeIndex {
  let types = typeIndexes.get(index);
  if (!types) {
    types = new TypeIndex(index);
    typeIndexes.set(index, types);
  }
  return types;
}

/** The row id a tag is: a person's `@name`, however written; any other tag's own key. */
export function rowIdOfTag(tagKey: string): string {
  return personRowId(tagKey) ?? tagKey;
}

/** A person tag's row id, `@dana` for `@dana` or `#person/dana`; undefined for any other tag. */
function personRowId(tagKey: string): string | undefined {
  const key = tagKey.toLowerCase();
  if (key.startsWith('@')) {
    return key;
  }
  return key.startsWith('#person/') && key.length > '#person/'.length ? `@${key.slice('#person/'.length)}` : undefined;
}

/** A tag key's last part, without its marker: `emea` for `#team/rates/emea`, `dana` for `@dana`. */
function lastSegment(key: string): string {
  const bare = key.replace(/^[#@]/, '');
  return bare.slice(bare.lastIndexOf('/') + 1);
}

/** A loose name as a tag's path: each part lowercased, each run of other characters a hyphen. */
function slugPath(text: string): string {
  return text
    .split('/')
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}_-]+/gu, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('/');
}

/** A path's segments: `team.lead` is `team`, `lead`; `field.status` stays one. */
export function splitFieldPath(path: string): string[] {
  const segments = path.split('.').map((segment) => segment.trim());
  const joined: string[] = [];
  for (let at = 0; at < segments.length; at += 1) {
    if (segments[at].toLowerCase() === 'field' && at + 1 < segments.length) {
      joined.push(`field.${segments[at + 1]}`);
      at += 1;
    } else {
      joined.push(segments[at]);
    }
  }
  return joined.filter(Boolean);
}

/** Path values, each row or written value once. */
function dedupeValues(values: PathValue[]): PathValue[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.rowId ?? value.notePath ?? `${value.filePath}\u0000${value.line}\u0000${value.text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** A one-value list written loosely, `rates, credit`, as its values, each on the line it was. */
function splitLooseList(value: FrontmatterValue): FrontmatterValue[] {
  if (!value.text.includes(',') || /\[\[/.test(value.text)) {
    return [value];
  }
  return value.text
    .split(',')
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text, ...(value.line ? { line: value.line } : {}) }));
}

/** Words joined as a sentence lists them: `a`, `a or b`, `a, b, or c`. */
function listWords(words: readonly string[]): string {
  if (words.length <= 2) {
    return words.join(' or ');
  }
  return `${words.slice(0, -1).join(', ')}, or ${words[words.length - 1]}`;
}

/**
 * The tags a search finds a task by: its own, its heading's, and every
 * heading's above; a task with no heading carries its note's front matter.
 */
function readTaskTagKeys(index: WorkspaceIndex, task: Task): Set<string> {
  const keys = new Set(task.tags);
  let section: Section | undefined = task.sectionId ? index.sections.get(task.sectionId) : undefined;
  section?.tags.forEach((key) => keys.add(key));
  const visited = new Set<string>();
  while (section?.parentSectionId && !visited.has(section.parentSectionId)) {
    visited.add(section.parentSectionId);
    section = index.sections.get(section.parentSectionId);
    section?.headingTags?.forEach((tag) => keys.add(tag.key));
  }
  return keys;
}

/** The innermost section of a note holding a line, or undefined above its first. */
function entryAtLine(file: ParsedFile, line: number): Section | undefined {
  let found: Section | undefined;
  file.sections.forEach((section) => {
    if (section.startLine <= line && line <= section.endLine && (!found || section.startLine >= found.startLine)) {
      found = section;
    }
  });
  return found;
}

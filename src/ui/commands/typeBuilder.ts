import * as vscode from 'vscode';

import type { IndexReader } from '../../core/workspace/indexReader';
import { toFrontmatterKey } from '../../domain/markdown/frontmatter';
import type { TypeField, TypeNote, TypeProblem } from '../../domain/model';
import { listRowSources, type RowSource } from '../../domain/types/createType';
import { setFrontmatterField, type FrontmatterFieldEdit } from '../../domain/types/frontmatterWriter';
import { slugTitle } from '../../domain/types/rowNotes';
import { editSchemaTable, type SchemaEdit, type SchemaEditResult } from '../../domain/types/typeSchemaEdits';
import type { TypeDefinition } from '../../domain/types/typeRegistry';
import {
  canHoldMany,
  checkFieldName,
  checkTypeName,
  createFieldMenuRows,
  createTypeFormRows,
  describeKindBase,
  findKindChoice,
  listKindChoices,
  listManyChoices,
  namesRows,
  readCommaList,
  readSelectOptions,
  writeKindCell,
  type BuilderRow,
  type BuilderType,
  type FieldMenuAction,
  type KindChoice,
  type NameCheck,
  type TypeFormAction,
} from '../state/typeBuilder';
import { findRowTypes } from '../state/typeRows';
import { noteName, reportFailure } from './notify';
import { createTypeNote, type TypeWrites } from './typeNotes';
import { renameTypeField } from './typeRenames';
import type { WorkspaceWriteHistory } from './workspaceWrites';

/**
 * The type builder (docs/implementation/44-type-builder.md): New Type…,
 * which writes a type note and opens its form, and Edit Type…, the form
 * itself, which lists a type's fields and adds, changes, moves, and
 * removes them. Each change is written to the type note when it is made,
 * as one write Undo Last Change takes back, and the form is drawn again
 * from the note as it is then.
 */

/** What the type builder reads and writes through. */
export interface TypeBuilderWrites extends TypeWrites {
  indexer: TypeWrites['indexer'] & Pick<IndexReader<vscode.Uri>, 'parse' | 'getFilePath'>;
  history: WorkspaceWriteHistory;
}

/**
 * The command a type note's CodeLens and a type's page open the form with:
 * a type note's URI or a type's key, and `{ add: true }` to add a field
 * first or `{ field }` to open a field's menu.
 */
export const EDIT_TYPE_COMMAND = 'deckard.editType';

/** A step's answer: what was chosen, Back, or undefined when the reader left. */
type Step<T> = T | typeof BACK | undefined;
const BACK = Symbol('back');

/**
 * New Type…: asks the type's name and what its rows are, writes
 * `Types/<Name>.md` with an empty table, opens it beside, and opens the
 * type form on it.
 */
export async function newType(writes: TypeBuilderWrites): Promise<void> {
  const { indexer } = writes;
  await indexer.ready;
  const registry = indexer.getTypeIndex().registry;
  let name = '';
  for (;;) {
    const named = await askText({
      title: 'New Type',
      step: [1, 2],
      value: name,
      placeholder: 'Name the type, such as Org, Vendor, or Incident',
      check: (value) => checkTypeName(value, registry.types),
    });
    if (named === undefined || named === BACK) {
      return;
    }
    name = named.trim();
    const rows = await pickRows(writes, name, { step: [2, 2] });
    if (rows === undefined) {
      return;
    }
    if (rows === BACK) {
      continue;
    }
    const uri = await createTypeNote(writes, { key: slugTitle(name), name, rows, fields: [] });
    if (uri) {
      await runTypeForm(writes, uri);
    }
    return;
  }
}

/**
 * Edit Type…: the form on a type, named by its key or its note's URI;
 * without one, on the type note in front, the first type of the row note
 * in front, or a type chosen from a list. `{ add: true }` opens the Add
 * field steps first, as a type note's CodeLens Add field… asks, and
 * `{ field }` a field's menu, as a column's Change field… asks.
 */
export async function editType(writes: TypeBuilderWrites, target?: unknown, options?: unknown): Promise<void> {
  const { indexer } = writes;
  await indexer.ready;
  const uri = await findTypeNote(writes, target);
  if (uri) {
    await runTypeForm(writes, uri, readFormStart(options));
  }
}

/** Where a command's options open the form, checked, since a command can be run with anything. */
function readFormStart(options: unknown): FormFocus {
  if (typeof options !== 'object' || options === null) {
    return {};
  }
  const { add, field } = options as Record<string, unknown>;
  if (add === true) {
    return { add: true };
  }
  return typeof field === 'string' && field ? { field: field.toLowerCase(), menu: true } : {};
}

/** The type note the form opens on: as named, else from the editor in front, else chosen. */
async function findTypeNote(writes: TypeBuilderWrites, target: unknown): Promise<vscode.Uri | undefined> {
  const { indexer } = writes;
  const registry = indexer.getTypeIndex().registry;
  if (target instanceof vscode.Uri) {
    return target;
  }
  if (typeof target === 'string') {
    const type = registry.get(target);
    const uri = type ? indexer.getUri(type.filePath) : undefined;
    if (!uri) {
      void reportFailure({ outcome: `No type is named ${target}, so Deckard did not open its form.` });
    }
    return uri;
  }
  const document = vscode.window.activeTextEditor?.document;
  if (document?.languageId === 'markdown') {
    const file = indexer.parse(document.uri, document.getText());
    if (file.typeNote) {
      return document.uri;
    }
    const rowType = findRowTypes(registry, file)[0];
    const uri = rowType ? indexer.getUri(rowType.filePath) : undefined;
    if (uri) {
      return uri;
    }
  }
  return chooseType(writes, registry.types);
}

/** A type chosen from the workspace's, or New Type… when there are none or it is chosen. */
async function chooseType(writes: TypeBuilderWrites, types: readonly TypeDefinition[]): Promise<vscode.Uri | undefined> {
  const items: Array<vscode.QuickPickItem & { type?: TypeDefinition }> = [
    ...types.map((type) => ({ label: type.name, description: type.filePath, type })),
    { label: '$(add) New Type…', description: 'Write a new type note' },
  ];
  const picked = await vscode.window.showQuickPick(items, { title: 'Edit Type', placeHolder: 'Choose a type to edit' });
  if (!picked) {
    return undefined;
  }
  if (!picked.type) {
    await newType(writes);
    return undefined;
  }
  return writes.indexer.getUri(picked.type.filePath);
}

/** Where the form opens: on a field's row or its menu, on Add field…'s steps, or on its first row. */
interface FormFocus {
  field?: string;
  add?: boolean;
  menu?: boolean;
}

/**
 * The type form: its rows drawn from the note as it is now, until Done or
 * Escape. Each choice opens its steps and comes back on the row it was
 * about.
 */
async function runTypeForm(writes: TypeBuilderWrites, uri: vscode.Uri, start: FormFocus = {}): Promise<void> {
  let focus: FormFocus = start;
  for (;;) {
    const type = await readType(writes, uri);
    if (!type) {
      void reportFailure({ outcome: `${noteName(uri)} is not a type note Deckard can read, so the type form closed.` });
      return;
    }
    if (focus.add) {
      focus = { field: (await addField(writes, uri, type.builder)) ?? undefined };
      continue;
    }
    const menuOf = focus.menu ? type.builder.fields.find((each) => each.key === focus.field) : undefined;
    if (menuOf) {
      focus = { field: await openFieldMenu(writes, uri, type, menuOf) };
      continue;
    }
    const chosen = await pickFormRow(uri, type, focus);
    if (!chosen || chosen.kind === 'done') {
      return;
    }
    switch (chosen.kind) {
      case 'field': {
        const field = type.builder.fields.find((each) => each.key === chosen.key);
        focus = { field: field ? await openFieldMenu(writes, uri, type, field) : chosen.key };
        break;
      }
      case 'add':
        focus = { add: true };
        break;
      case 'rows':
        await changeRows(writes, uri, type.builder);
        focus = {};
        break;
      case 'folder':
        await changeFolder(writes, uri, type.builder);
        focus = {};
        break;
      case 'open':
        await vscode.window.showTextDocument(uri, { preview: false, viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
        focus = {};
        break;
    }
  }
}

/** A type as the form reads it: its note as the editor holds it now, what is wrong with it, and how many rows it has. */
interface FormType {
  builder: BuilderType;
  problems: TypeProblem[];
  rowCount: number;
}

/**
 * The type note as the editor holds it now, read on its own, with the
 * problems the registry found once every type was read, attached by field
 * rather than line, since the note may have changed since.
 */
async function readType(writes: TypeBuilderWrites, uri: vscode.Uri): Promise<FormType | undefined> {
  const { indexer } = writes;
  const document = await vscode.workspace.openTextDocument(uri);
  const note: TypeNote | undefined = indexer.parse(uri, document.getText()).typeNote;
  if (!note) {
    return undefined;
  }
  const filePath = indexer.getFilePath(uri);
  const types = indexer.getTypeIndex();
  const fieldKeys = new Set(note.fields.map((field) => field.key));
  const registryProblems = types.registry.problems
    .filter((problem) => problem.filePath === filePath && problem.field !== undefined && fieldKeys.has(problem.field))
    .map((problem) => ({ ...problem, line: -1 }));
  return {
    builder: { ...note, filePath },
    problems: [...note.problems, ...registryProblems],
    rowCount: types.rows(note.key).length,
  };
}

/** A pick's item that carries what choosing it does. */
type ActionItem<A> = vscode.QuickPickItem & { action?: A };

/** A builder row as a pick's item: a separator as VS Code draws one, and the row's icon before its label. */
function toItem<A>(row: BuilderRow<A>): ActionItem<A> {
  if (row.separator) {
    return { label: row.label, kind: vscode.QuickPickItemKind.Separator };
  }
  return {
    label: row.icon ? `$(${row.icon}) ${row.label}` : row.label,
    ...(row.description === undefined ? {} : { description: row.description }),
    ...(row.detail === undefined ? {} : { detail: row.detail }),
    ...(row.action === undefined ? {} : { action: row.action }),
  };
}

/** The button that opens the type note beside the form. */
const OPEN_NOTE_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('go-to-file'), tooltip: 'Open the type note beside' };

/** One turn of the type form: the row chosen, or undefined when the reader left. */
function pickFormRow(uri: vscode.Uri, type: FormType, focus: FormFocus): Promise<TypeFormAction | undefined> {
  const items = createTypeFormRows(type.builder, { problems: type.problems, rowCount: type.rowCount }).map(toItem);
  return new Promise((resolve) => {
    const pick = vscode.window.createQuickPick<ActionItem<TypeFormAction>>();
    pick.title = `${type.builder.name} · ${type.builder.filePath}`;
    pick.placeholder = 'Choose a field to change, or add one';
    pick.items = items;
    pick.matchOnDescription = true;
    pick.ignoreFocusOut = true;
    pick.buttons = [OPEN_NOTE_BUTTON];
    const active = items.find((item) => item.action?.kind === 'field' && item.action.key === focus.field)
      ?? (type.builder.fields.length === 0 ? items.find((item) => item.action?.kind === 'add') : undefined);
    if (active) {
      pick.activeItems = [active];
    }
    let answer: TypeFormAction | undefined;
    pick.onDidTriggerButton(() => {
      void vscode.window.showTextDocument(uri, { preview: false, viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    });
    pick.onDidAccept(() => {
      answer = pick.selectedItems[0]?.action;
      pick.hide();
    });
    pick.onDidHide(() => {
      pick.dispose();
      resolve(answer);
    });
    pick.show();
  });
}

/** A field being added, as its steps fill it. */
interface FieldDraft {
  name: string;
  /** The Kind cell without `, many`. */
  kind: string;
  many: boolean;
  reverse: string;
}

/** Where a step leaves Add field: on to the next step, back to the one before, or out. */
type StepResult = 'next' | 'back' | 'leave';

/** One of Add field's steps, given its place among them. */
type FieldStep = (draft: FieldDraft, at: [number, number]) => Promise<StepResult>;

/** A step's answer as where it leaves Add field, with the answer put in the draft. */
function settle<T>(answer: Step<T>, apply: (value: T) => void): StepResult {
  if (answer === undefined) {
    return 'leave';
  }
  if (answer === BACK) {
    return 'back';
  }
  apply(answer);
  return 'next';
}

/**
 * Add field: its name, its kind, one or many (not for Checkbox), and, for
 * a field that names rows, what the other side calls it, each with Back to
 * the step before. The new field's key once its row is written; undefined
 * when the reader left or nothing was written.
 */
async function addField(writes: TypeBuilderWrites, uri: vscode.Uri, type: BuilderType): Promise<string | undefined> {
  const types = writes.indexer.getTypeIndex().registry.types;
  const draft: FieldDraft = { name: '', kind: '', many: false, reverse: '' };
  const steps = (): FieldStep[] => [
    async (field, at) => {
      const named = await askText({ title: `Add a field to ${type.name}`, step: at, value: field.name, placeholder: 'Name the field, such as lead, tier, or Distribution List', check: (value) => checkFieldName(value, type) });
      return named === BACK ? 'leave' : settle(named, (value) => (field.name = value.trim().replace(/\s+/g, ' ')));
    },
    async (field, at) => settle(await pickKind(types, { title: `${field.name} · Kind`, step: at, current: field.kind, fieldName: field.name }), (value) => (field.kind = value)),
    ...(draft.kind && !canHoldMany(draft.kind) ? [] : [askFieldMany]),
    ...(draft.kind && !namesRows(draft.kind) ? [] : [askFieldReverse]),
  ];
  for (let at = 0; at < steps().length; ) {
    const list = steps();
    const result = await list[at](draft, [at + 1, list.length]);
    if (result === 'leave' || (result === 'back' && at === 0)) {
      return undefined;
    }
    at += result === 'back' ? -1 : 1;
  }
  const many = draft.many && canHoldMany(draft.kind);
  const field = { name: draft.name, kind: writeKindCell(draft.kind, { many }), ...(draft.reverse && namesRows(draft.kind) ? { reverse: draft.reverse } : {}) };
  const written = await writeSchema(writes, uri, { kind: 'add', field }, `Add ${draft.name} to ${type.name}`);
  return written ? toFrontmatterKey(draft.name) : undefined;
}

/** Add field's one or many. */
const askFieldMany: FieldStep = async (field, at) =>
  settle(
    await pickOne(listManyChoices(field.name, field.kind), { title: `${field.name} · ${describeKindBase(field.kind)}`, step: at, placeholder: `How many does ${field.name} hold?`, active: (value) => value === field.many }),
    (value) => (field.many = value),
  );

/** Add field's reverse, for a field that names rows. */
const askFieldReverse: FieldStep = async (field, at) =>
  settle(
    await askText({ title: `${field.name} · On the other side`, step: at, value: field.reverse, placeholder: `${field.name} of`, check: () => describeReverse(field.name) }),
    (value) => (field.reverse = value.trim()),
  );

/** What a reverse's input says under it. */
function describeReverse(name: string): NameCheck {
  return { message: `What the page of a row ${name} names calls the link. Leave it empty for "${name} of".` };
}

/**
 * The kind list: rows first, then values. Select… asks its options next,
 * filled with the current ones; More than one type… asks which types.
 * The Kind cell without `, many`, Back, or undefined when the reader left.
 */
async function pickKind(
  types: readonly TypeDefinition[],
  options: { title: string; step?: [number, number]; current: string; fieldName: string },
): Promise<Step<string>> {
  const rows = listKindChoices(types);
  const current = options.current ? findKindChoice(options.current, rows) : undefined;
  for (;;) {
    const chosen = await pickOne<KindChoice>(rows, {
      title: options.title,
      ...(options.step ? { step: options.step } : {}),
      placeholder: `What does ${options.fieldName} hold?`,
      active: (action) => current?.action !== undefined && JSON.stringify(action) === JSON.stringify(current.action),
    });
    if (chosen === undefined || chosen === BACK) {
      return chosen;
    }
    switch (chosen.kind) {
      case 'word':
        return chosen.word;
      case 'type':
        return chosen.name;
      case 'types': {
        const named = await pickTypes(types, options.current);
        if (named === BACK) {
          continue;
        }
        return named;
      }
      case 'select': {
        const listed = await askText({
          title: `${options.fieldName} · Options`,
          value: readSelectOptions(options.current).join(', '),
          placeholder: 'gold, silver, bronze',
          check: (value) => (readCommaList(value).length ? { message: `A value is one of: ${readCommaList(value).join(', ')}.` } : { message: 'Write the options, separated by commas.' }),
        });
        if (listed === BACK || (listed !== undefined && readCommaList(listed).length === 0)) {
          continue;
        }
        return listed === undefined ? undefined : writeKindCell('', { selectOptions: readCommaList(listed) });
      }
    }
  }
}

/** More than one type…: the types chosen, written `Team or Area`; Back when none or the reader left. */
async function pickTypes(types: readonly TypeDefinition[], current: string): Promise<Step<string>> {
  const chosenNow = new Set(describeKindBase(current).split(/\s+or\s+/i).map((name) => name.trim().toLowerCase()));
  const items = [{ label: 'Person', picked: chosenNow.has('person') }, ...types.filter((type) => type.rows?.kind !== 'tags' || type.rows.prefix !== '@').map((type) => ({ label: type.name, picked: chosenNow.has(type.name.toLowerCase()) }))];
  const picked = await vscode.window.showQuickPick(items, { title: 'Which types can it name?', placeHolder: 'Choose two or more', canPickMany: true });
  return picked && picked.length > 0 ? picked.map((item) => item.label).join(' or ') : BACK;
}

/** Rows: the namespaces in use, another namespace, the people, or notes with `type:`. The `rows:` value, Back, or undefined. */
async function pickRows(writes: TypeBuilderWrites, name: string, options: { step?: [number, number]; current?: TypeNote['rows'] }): Promise<Step<string>> {
  const index = writes.indexer.getSnapshot();
  const registry = writes.indexer.getTypeIndex().registry;
  const key = slugTitle(name);
  const sources = listRowSources(index, registry).filter((source) => source.kind !== 'notes');
  const close = (source: RowSource): boolean => source.key === key || source.key === `${key}s` || `${source.key}s` === key;
  const ranked = [...sources.filter(close), ...sources.filter((source) => !close(source))];
  const rows: Array<BuilderRow<string>> = [
    ...(ranked.length ? [{ label: 'Tags in use', separator: true } as const] : []),
    ...ranked.map((source): BuilderRow<string> => source.kind === 'people'
      ? { label: 'Each person', description: `${source.tagCount} people`, icon: 'person', action: '@*' }
      : { label: `Each #${source.key}/… tag`, description: `${source.tagCount} tags, ${source.noteCount} with a hub note`, icon: 'symbol-namespace', action: `#${source.key}/*` }),
    { label: 'Or', separator: true },
    { label: 'Another namespace…', description: `such as #${key || 'org'}/`, icon: 'add', action: '' },
    { label: `Each note that says type: ${key}`, description: 'for records such as decisions', icon: 'note', action: 'notes' },
  ];
  const written = options.current?.written;
  for (;;) {
    const chosen = await pickOne(rows, {
      title: `${name} · Rows`,
      ...(options.step ? { step: options.step } : {}),
      placeholder: `What is a ${name}?`,
      active: (action) => action === written || (written === undefined && action === `#${key}/*`),
    });
    if (chosen !== '') {
      return chosen;
    }
    const typed = await askText({
      title: `${name} · Namespace`,
      value: `#${key}/`,
      placeholder: `#${key}/`,
      check: (value) => (/^#?[\p{L}\p{N}][\p{L}\p{N}\p{M}_/-]*\/?\*?$/u.test(value.trim()) ? { message: `Each tag under #${value.trim().replace(/^#/, '').replace(/\/?\*?$/, '')}/ is a ${name}.` } : { error: 'Write a namespace, such as #org/.' }),
    });
    if (typed === undefined) {
      return undefined;
    }
    if (typed !== BACK) {
      return `#${typed.trim().replace(/^#/, '').replace(/\/?\*?$/, '')}/*`;
    }
  }
}

/** The type's rows changed, written to `rows:`. */
async function changeRows(writes: TypeBuilderWrites, uri: vscode.Uri, type: BuilderType): Promise<void> {
  const rows = await pickRows(writes, type.name, { current: type.rows });
  if (typeof rows === 'string' && rows !== type.rows?.written) {
    await writeFrontmatter(writes, uri, (content) => setFrontmatterField(content, 'rows', { values: [{ text: rows }] }), `Set ${type.name}'s rows`);
  }
}

/** The folder a namespace type's new notes go in, written to `notes:`; empty takes it out. */
async function changeFolder(writes: TypeBuilderWrites, uri: vscode.Uri, type: BuilderType): Promise<void> {
  const typed = await askText({
    title: `${type.name} · New notes go in`,
    value: type.notesFolder ?? '',
    placeholder: 'Orgs/',
    check: (value) => (/[\\:*?"<>|]/.test(value) ? { error: 'A folder cannot have \\ : * ? " < > |.' } : { message: 'A folder under the notes folder. Leave it empty for the plural of the type\'s name.' }),
  });
  if (typeof typed !== 'string') {
    return;
  }
  const folder = typed.trim().replace(/^\/+/, '');
  const values = folder ? [{ text: folder.endsWith('/') ? folder : `${folder}/` }] : [];
  await writeFrontmatter(writes, uri, (content) => setFrontmatterField(content, 'notes', { values }), `Set where new ${type.name} notes go`);
}

/** A field in the type form, with the note it is written in. */
interface FieldAt {
  writes: TypeBuilderWrites;
  uri: vscode.Uri;
  type: BuilderType;
  field: TypeField;
}

/**
 * A field's menu, and the change chosen on it, written. The field's key
 * afterward, for the form to come back on.
 */
async function openFieldMenu(writes: TypeBuilderWrites, uri: vscode.Uri, type: FormType, field: TypeField): Promise<string | undefined> {
  const at: FieldAt = { writes, uri, type: type.builder, field };
  const notes = countNotesWriting(writes, type.builder.key, field.key);
  const chosen = await pickOne<FieldMenuAction>(createFieldMenuRows(type.builder, field, notes), {
    title: `${type.builder.name} · ${field.name}`,
    placeholder: `Change ${field.name}`,
  });
  if (chosen === undefined || chosen === BACK) {
    return field.key;
  }
  switch (chosen.kind) {
    case 'rename':
      return renameField(at);
    case 'remove':
      return removeField(at, notes);
    case 'move':
      await setField(at, { kind: 'move', field: field.key, by: chosen.by }, `Move ${field.name} ${chosen.by < 0 ? 'up' : 'down'}`);
      return field.key;
    case 'kind':
      await changeKind(at);
      return field.key;
    case 'many':
      await changeMany(at);
      return field.key;
    case 'reverse':
    case 'alsoCalled':
    case 'words':
      await changeText(at, chosen.kind);
      return field.key;
  }
}

/** Writes a table edit about the field. */
async function setField(at: FieldAt, edit: SchemaEdit, label: string): Promise<boolean> {
  return writeSchema(at.writes, at.uri, edit, label);
}

/** Kind: the kind list on the field's kind, keeping one or many where the new kind can hold several. */
async function changeKind(at: FieldAt): Promise<void> {
  const { field } = at;
  const kind = await pickKind(at.writes.indexer.getTypeIndex().registry.types, { title: `${field.name} · Kind`, current: field.kindText, fieldName: field.name });
  if (typeof kind === 'string') {
    await setField(at, { kind: 'set', field: field.key, cells: { kind: writeKindCell(kind, { many: field.kind.many && canHoldMany(kind) }) } }, `Make ${field.name} ${describeKindBase(kind)}`);
  }
}

/** Holds: one or several. */
async function changeMany(at: FieldAt): Promise<void> {
  const { field } = at;
  const many = await pickOne(listManyChoices(field.name, field.kindText), { title: `${field.name} · Holds`, placeholder: `How many does ${field.name} hold?`, active: (value) => value === field.kind.many });
  if (typeof many === 'boolean' && many !== field.kind.many) {
    await setField(at, { kind: 'set', field: field.key, cells: { kind: writeKindCell(describeKindBase(field.kindText), { many }) } }, `${field.name} holds ${many ? 'several' : 'one'}`);
  }
}

/** Reverse, Also called, or Words: the cell's text, asked with what it is now. */
async function changeText(at: FieldAt, cell: 'reverse' | 'alsoCalled' | 'words'): Promise<void> {
  const { field } = at;
  const asks = {
    reverse: { title: 'On the other side', value: field.reverse ?? '', placeholder: `${field.name} of`, check: () => describeReverse(field.name), label: `Set ${field.name}'s reverse` },
    alsoCalled: { title: 'Also called', value: field.alsoCalled.join(', '), placeholder: 'head, owner', check: () => ({ message: 'Other words Find and assistants know the field by, separated by commas.' }), label: `Set what ${field.name} is also called` },
    words: { title: 'Words', value: field.words?.join(', ') ?? '', placeholder: 'now leads, took over', check: () => ({ message: 'Phrases on a line that mean the field, separated by commas, so File this offers to set it.' }), label: `Set ${field.name}'s words` },
  }[cell];
  const text = await askText({ ...asks, title: `${field.name} · ${asks.title}` });
  if (typeof text !== 'string') {
    return;
  }
  const cells = cell === 'reverse' ? { reverse: text.trim() } : { [cell]: readCommaList(text) };
  await setField(at, { kind: 'set', field: field.key, cells }, asks.label);
}

/**
 * Rename…: Rename field everywhere, which rewrites the key in every row
 * note, once the index has the field; a field just added, which no note
 * writes yet, is renamed in the table alone.
 */
async function renameField({ writes, uri, type, field }: FieldAt): Promise<string | undefined> {
  const indexed = writes.indexer.getTypeIndex().registry.get(type.key)?.fields.some((each) => each.key === field.key);
  if (indexed) {
    await renameTypeField(writes, type.key, field.key);
    const after = (await readType(writes, uri))?.builder.fields.find((each) => each.line === field.line);
    return after?.key ?? field.key;
  }
  const name = await askText({ title: `Rename ${field.name}`, value: field.name, check: (value) => checkFieldName(value, type, field.key) });
  if (typeof name !== 'string' || name.trim() === field.name) {
    return field.key;
  }
  return (await writeSchema(writes, uri, { kind: 'set', field: field.key, cells: { name } }, `Rename ${field.name} to ${name.trim()}`)) ? toFrontmatterKey(name) : field.key;
}

/** Remove: asks first, naming the notes that keep their values, then takes the table row out. */
async function removeField({ writes, uri, type, field }: FieldAt, notes: number): Promise<string | undefined> {
  const kept = notes ? ` ${notes} ${notes === 1 ? 'note writes it and keeps its value' : 'notes write it and keep their values'}, shown as other keys.` : '';
  const answer = await vscode.window.showWarningMessage(`Remove ${field.name} from ${type.name}?`, { modal: true, detail: `Its row comes out of the type's table.${kept}` }, 'Remove');
  if (answer !== 'Remove') {
    return field.key;
  }
  await writeSchema(writes, uri, { kind: 'remove', field: field.key }, `Remove ${field.name} from ${type.name}`);
  return undefined;
}

/** How many of a type's rows have a note that writes the field. */
function countNotesWriting(writes: TypeBuilderWrites, typeKey: string, fieldKey: string): number {
  const index = writes.indexer.getSnapshot();
  return writes.indexer.getTypeIndex().rows(typeKey).filter((row) => row.filePath && index.files.get(row.filePath)?.properties?.some((property) => property.name === fieldKey)).length;
}

/**
 * Makes a table edit against the type note as the editor holds it now, as
 * one write, saved; says why when it cannot be made. True when written.
 */
async function writeSchema(writes: TypeBuilderWrites, uri: vscode.Uri, edit: SchemaEdit, label: string): Promise<boolean> {
  const document = await vscode.workspace.openTextDocument(uri);
  const planned = editSchemaTable(document.getText(), edit);
  if (planned.kind === 'refused') {
    void reportFailure({ outcome: describeRefusal(planned, noteName(uri)) });
    return false;
  }
  return planned.kind === 'edit' ? applyLines(writes, document, planned, label) : true;
}

/** Why a table edit was not made, in a sentence. */
function describeRefusal(refused: Extract<SchemaEditResult, { kind: 'refused' }>, note: string): string {
  switch (refused.reason) {
    case 'bad-name':
      return `That name cannot be a front-matter key, so ${note} was not changed.`;
    case 'name-taken':
      return `${note} already has a field by that name, on line ${refused.line}.`;
    case 'no-field':
      return `${note} no longer has that field; it may have been changed by hand.`;
    case 'no-table':
      return `${note} has no table with Field and Kind columns.`;
  }
}

/** Makes a front-matter edit against the type note as the editor holds it now, as one write. */
async function writeFrontmatter(writes: TypeBuilderWrites, uri: vscode.Uri, plan: (content: string) => FrontmatterFieldEdit, label: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const planned = plan(document.getText());
  if (planned.kind === 'refused') {
    void reportFailure({ outcome: `Deckard cannot rewrite that line of ${noteName(uri)} safely; it is opened at line ${planned.line}.` });
    await vscode.window.showTextDocument(uri, { selection: new vscode.Range(planned.line - 1, 0, planned.line - 1, 0), viewColumn: vscode.ViewColumn.Beside });
    return;
  }
  if (planned.kind === 'edit') {
    await applyLines(writes, document, planned, label);
  }
}

/** Replaces a document's lines `start` to `start + deleted` with `lines`, as one saved write. True when applied. */
async function applyLines(
  writes: TypeBuilderWrites,
  document: vscode.TextDocument,
  planned: { start: number; deleted: number; lines: readonly string[] },
  label: string,
): Promise<boolean> {
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const edit = new vscode.WorkspaceEdit();
  const end = planned.start + planned.deleted;
  if (end < document.lineCount) {
    edit.replace(document.uri, new vscode.Range(planned.start, 0, end, 0), planned.lines.map((line) => `${line}${eol}`).join(''));
  } else if (planned.start < document.lineCount) {
    edit.replace(document.uri, new vscode.Range(new vscode.Position(planned.start, 0), document.lineAt(document.lineCount - 1).range.end), planned.lines.join(eol));
  } else {
    edit.insert(document.uri, document.lineAt(document.lineCount - 1).range.end, `${eol}${planned.lines.join(eol)}`);
  }
  const result = await writes.history.write(edit, { label, preview: 'never' });
  if (!result.applied) {
    void reportFailure({ outcome: `VS Code did not accept the change, so ${noteName(document.uri)} was not changed.` });
    return false;
  }
  return true;
}

/** How a text step is asked: its title, step count, starting value, and the check run as it is typed. */
interface TextStep {
  title: string;
  step?: [number, number];
  value: string;
  placeholder?: string;
  check: (value: string) => NameCheck;
}

/**
 * An input box with Back: the text on Enter (refused while the check
 * gives an error), BACK, or undefined when the reader left.
 */
function askText(options: TextStep): Promise<Step<string>> {
  return new Promise((resolve) => {
    const input = vscode.window.createInputBox();
    input.title = options.title;
    if (options.step) {
      [input.step, input.totalSteps] = options.step;
    }
    input.value = options.value;
    input.placeholder = options.placeholder;
    input.ignoreFocusOut = true;
    input.buttons = [vscode.QuickInputButtons.Back];
    const validate = (value: string): void => {
      input.validationMessage = toValidation(options.check(value));
    };
    validate(input.value);
    let answer: Step<string>;
    input.onDidChangeValue(validate);
    input.onDidTriggerButton(() => {
      answer = BACK;
      input.hide();
    });
    input.onDidAccept(() => {
      if (options.check(input.value).error) {
        return;
      }
      answer = input.value;
      input.hide();
    });
    input.onDidHide(() => {
      input.dispose();
      resolve(answer);
    });
    input.show();
  });
}

/** A name check as an input box shows it: an error that refuses Enter, or a message under the input. */
function toValidation(check: NameCheck): vscode.InputBoxValidationMessage | undefined {
  if (check.error) {
    return { message: check.error, severity: vscode.InputBoxValidationSeverity.Error };
  }
  return check.message ? { message: check.message, severity: vscode.InputBoxValidationSeverity.Info } : undefined;
}

/** How a pick step is shown: its title, step count, placeholder, and the row it opens on. */
interface PickStep<A> {
  title: string;
  step?: [number, number];
  placeholder: string;
  active?: (action: A) => boolean;
}

/** A quick pick of builder rows with Back: the chosen row's action, BACK, or undefined when the reader left. */
function pickOne<A>(rows: ReadonlyArray<BuilderRow<A>>, options: PickStep<A>): Promise<Step<A>> {
  const items = rows.map(toItem);
  return new Promise((resolve) => {
    const pick = vscode.window.createQuickPick<ActionItem<A>>();
    pick.title = options.title;
    if (options.step) {
      [pick.step, pick.totalSteps] = options.step;
    }
    pick.placeholder = options.placeholder;
    pick.items = items;
    pick.matchOnDescription = true;
    pick.ignoreFocusOut = true;
    pick.buttons = [vscode.QuickInputButtons.Back];
    const active = options.active ? items.find((item) => item.action !== undefined && options.active?.(item.action)) : undefined;
    if (active) {
      pick.activeItems = [active];
    }
    let answer: Step<A>;
    pick.onDidTriggerButton(() => {
      answer = BACK;
      pick.hide();
    });
    pick.onDidAccept(() => {
      const chosen = pick.selectedItems[0];
      if (chosen?.action === undefined) {
        return;
      }
      answer = chosen.action;
      pick.hide();
    });
    pick.onDidHide(() => {
      pick.dispose();
      resolve(answer);
    });
    pick.show();
  });
}

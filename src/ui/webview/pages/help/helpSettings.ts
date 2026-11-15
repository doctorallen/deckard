/**
 * The settings This page lists (plan 48, section 2): each read from the
 * extension's own `contributes.configuration`, so Help says what VS Code's
 * Settings says, with its value now and where that value is set. Nothing
 * here touches VS Code; the controller reads and writes.
 */
import { settingLabel } from '../../../state/settingLabel';

/** A setting's schema, as `package.json` contributes it. */
export interface SettingSchema {
  type?: string | readonly string[];
  enum?: readonly unknown[];
  enumItemLabels?: readonly string[];
  description?: string;
  markdownDescription?: string;
  properties?: Readonly<Record<string, SettingSchema>>;
  default?: unknown;
  scope?: string;
  minimum?: number;
  maximum?: number;
}

/** The part of `contributes` the settings come from. */
export interface SettingsManifest {
  configuration?: unknown;
}

/** What VS Code's `inspect` says of a setting's values. */
export interface InspectedSetting {
  defaultValue?: unknown;
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

/** How Help edits a setting in place, or that it does not. */
export type SettingKind = 'boolean' | 'enum' | 'number' | 'string' | 'flags' | 'other';

/** One setting as This page draws it. */
export interface SettingView {
  /** Its key without `deckard.`, such as `board.limits`. */
  key: string;
  /** Its name as VS Code's Settings heads it, such as `Board: Limits`. */
  label: string;
  /** Its description, as contributed, in Markdown. */
  description: string;
  kind: SettingKind;
  /** Its value now, wherever that comes from. */
  value: unknown;
  /** Where its value comes from. */
  source: 'Workspace' | 'User' | 'Default';
  /** An enum's values and their names. */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** An object of booleans' properties, each its name, its words, and whether it is on. */
  flags?: ReadonlyArray<{ name: string; label: string; on: boolean }>;
  /** A setting Help does not edit in place: its value in a few words. */
  summary?: string;
}

/** Every contributed setting's schema, by its full key. */
export function listSettingSchemas(manifest: SettingsManifest): Map<string, SettingSchema> {
  const configuration = manifest.configuration;
  let sections: unknown[] = [];
  if (Array.isArray(configuration)) {
    sections = configuration;
  } else if (configuration) {
    sections = [configuration];
  }
  const schemas = new Map<string, SettingSchema>();
  for (const section of sections as Array<{ properties?: Record<string, SettingSchema> }>) {
    for (const [key, schema] of Object.entries(section?.properties ?? {})) {
      schemas.set(key, schema);
    }
  }
  return schemas;
}

/** How Help edits a setting with this schema in place. */
export function settingKind(schema: SettingSchema): SettingKind {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.enum && schema.enum.every((value) => typeof value === 'string')) {
    return 'enum';
  }
  if (type === 'boolean') {
    return 'boolean';
  }
  if (type === 'number' || type === 'integer') {
    return 'number';
  }
  if (type === 'string') {
    return 'string';
  }
  if (type === 'object' && schema.properties && Object.values(schema.properties).every((property) => property.type === 'boolean')) {
    return 'flags';
  }
  return 'other';
}

/** Where a setting's value comes from, and the value. */
function readValue(inspected: InspectedSetting | undefined): { value: unknown; source: SettingView['source'] } {
  if (inspected?.workspaceFolderValue !== undefined) {
    return { value: inspected.workspaceFolderValue, source: 'Workspace' };
  }
  if (inspected?.workspaceValue !== undefined) {
    return { value: inspected.workspaceValue, source: 'Workspace' };
  }
  if (inspected?.globalValue !== undefined) {
    return { value: inspected.globalValue, source: 'User' };
  }
  return { value: inspected?.defaultValue, source: 'Default' };
}

/** A value Help does not edit in place, in a few words. */
function summarize(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? 'None' : `${value.length} ${value.length === 1 ? 'entry' : 'entries'}`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length === 0 ? 'None' : entries.map(([name, item]) => `${name}: ${String(item)}`).join(', ');
  }
  return value === undefined || value === '' ? 'Not set' : String(value);
}

/** A setting as This page draws it, from its schema and what `inspect` says of it. */
export function describeSetting(key: string, schema: SettingSchema, inspected: InspectedSetting | undefined): SettingView {
  const { value, source } = readValue(inspected);
  const kind = settingKind(schema);
  const view: SettingView = {
    key,
    label: settingLabel(key),
    description: schema.markdownDescription ?? schema.description ?? '',
    kind,
    value,
    source,
  };
  if (kind === 'enum') {
    const values = (schema.enum ?? []) as string[];
    return { ...view, options: values.map((option, at) => ({ value: option, label: schema.enumItemLabels?.[at] ?? optionLabel(option) })) };
  }
  if (kind === 'flags') {
    const current = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    return {
      ...view,
      flags: Object.entries(schema.properties ?? {}).map(([name, property]) => ({
        name,
        label: property.description ?? optionLabel(name),
        on: current[name] === true,
      })),
    };
  }
  if (kind === 'other') {
    return { ...view, summary: summarize(value) };
  }
  return view;
}

/** An enum value's name, when the schema gives none: `mimic` is `Mimic`, `workflow` is `Workflow`. */
function optionLabel(value: string): string {
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A write, or none, from what was sent: one checker per kind of setting. */
type WriteReader = (view: SettingView, schema: SettingSchema, sent: unknown) => { value: unknown } | undefined;

/** A number from what was sent: a number, or text that reads as one. */
function readNumber(sent: unknown): number {
  if (typeof sent === 'number') {
    return sent;
  }
  return typeof sent === 'string' && sent.trim() !== '' ? Number(sent) : Number.NaN;
}

/** A number within the setting's bounds. */
const readNumberWrite: WriteReader = (_view, schema, sent) => {
  const number = readNumber(sent);
  const outside = (schema.minimum !== undefined && number < schema.minimum) || (schema.maximum !== undefined && number > schema.maximum);
  return Number.isFinite(number) && !outside ? { value: number } : undefined;
};

/** One flag of an object of booleans, written as the whole object with that flag changed. */
const readFlagWrite: WriteReader = (view, _schema, sent) => {
  if (!sent || typeof sent !== 'object') {
    return undefined;
  }
  const { name, on } = sent as { name?: unknown; on?: unknown };
  if (typeof name !== 'string' || typeof on !== 'boolean' || !view.flags?.some((flag) => flag.name === name)) {
    return undefined;
  }
  const current = Object.fromEntries((view.flags ?? []).map((flag) => [flag.name, flag.on]));
  return { value: { ...current, [name]: on } };
};

const WRITE_READERS: Readonly<Record<SettingKind, WriteReader>> = {
  boolean: (_view, _schema, sent) => (typeof sent === 'boolean' ? { value: sent } : undefined),
  enum: (view, _schema, sent) => (typeof sent === 'string' && view.options?.some((option) => option.value === sent) ? { value: sent } : undefined),
  number: readNumberWrite,
  string: (_view, _schema, sent) => (typeof sent === 'string' && sent.length <= 200 ? { value: sent.trim() } : undefined),
  flags: readFlagWrite,
  other: () => undefined,
};

/**
 * A value This page sent for a setting, checked against its schema: the
 * value to write, or undefined when it does not fit. A flag is sent as
 * `{ name, on }` and written as the whole object with that flag changed.
 */
export function readSettingWrite(view: SettingView, schema: SettingSchema, sent: unknown): { value: unknown } | undefined {
  return WRITE_READERS[view.kind](view, schema, sent);
}

import type { ResourceUri } from './uri';

/**
 * One section of the settings, such as `deckard` or `files`, as VS Code's
 * `WorkspaceConfiguration` reads it: a value by its key within the section.
 */
export interface ConfigurationSection {
  /** The effective value of `key`, or undefined when nothing sets it. */
  get<T>(key: string): T | undefined;
  /** The effective value of `key`, or `defaultValue` when nothing sets it. */
  get<T>(key: string, defaultValue: T): T;
}

/**
 * Reading settings, as `vscode.workspace.getConfiguration` does, so
 * `vscode.workspace` is one as it is.
 *
 * A `scope` reads the settings as they apply to that resource, its
 * workspace folder's settings over the workspace's; without one, the
 * workspace's alone. Which of the two a caller asks for is part of what it
 * reads, so the index keeps each read's scope exactly.
 */
export interface Configuration<U extends ResourceUri = ResourceUri> {
  getConfiguration(section: string, scope?: U): ConfigurationSection;
}

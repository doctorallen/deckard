/**
 * The part of a VS Code `Uri` that the index reads: which file system a
 * resource is on, its path in URI form and as the platform writes it, and
 * its text form as a key.
 *
 * The index is written against this shape and carries the URI type it is
 * given as a type parameter, so a VS Code `Uri` handed to the scanner comes
 * back out of it as the same `Uri`, with nothing lost, and a test can pass
 * a plain object instead.
 */
export interface ResourceUri {
  /** `file` for a file on disk; anything else is resolved by the workspace. */
  readonly scheme: string;
  /** The path in URI form, with `/` separators. */
  readonly path: string;
  /** The path as the platform writes it, with its own separators. */
  readonly fsPath: string;
  /** The URI as one string, which the index uses as a key for a file. */
  toString(): string;
}

/**
 * One root folder of the workspace, as VS Code's `WorkspaceFolder` has it:
 * its URI, its name, which prefixes index paths in a multi-root workspace,
 * and its position among the roots.
 */
export interface WorkspaceFolder<U extends ResourceUri = ResourceUri> {
  readonly uri: U;
  readonly name: string;
  readonly index: number;
}

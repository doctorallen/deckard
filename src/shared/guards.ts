/**
 * Type guards for values that arrive untyped: JSON-RPC requests, webview
 * messages, tool inputs, and backup files. Nothing here reaches `vscode`.
 */

/**
 * Whether `value` is a plain object whose fields can be read by name: not
 * null and not an array. Use it where an array in the place of an object is
 * malformed input, as in a JSON-RPC request or a preferences backup.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether `value` is any non-null object, arrays included, narrowed so its
 * fields can be read without assuming any of them. The webview messages and
 * the language-model tool inputs check each field afterwards, so they never
 * rejected an array here, and this keeps them from starting to.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

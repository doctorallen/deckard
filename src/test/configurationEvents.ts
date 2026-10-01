import * as vscode from 'vscode';

/**
 * Runs `build` with `vscode.workspace.onDidChangeConfiguration` handed out
 * by an emitter the test fires, so what `build` listens to can be sent one
 * change that touches several settings at once, as an edit to
 * settings.json does. The real event is put back before this returns.
 */
export function withConfigurationEvents<T>(build: () => T): {
  result: T;
  /** Fires one change to every setting named, and to the sections they are in. */
  fire(...settings: string[]): void;
} {
  const emitter = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>();
  const workspace = vscode.workspace as unknown as Record<string, unknown>;
  const original = workspace.onDidChangeConfiguration;
  workspace.onDidChangeConfiguration = emitter.event;
  try {
    return {
      result: build(),
      fire: (...settings) =>
        emitter.fire({
          affectsConfiguration: (section: string) =>
            settings.some((setting) => setting === section || setting.startsWith(`${section}.`)),
        }),
    };
  } finally {
    workspace.onDidChangeConfiguration = original;
  }
}

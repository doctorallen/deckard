import type * as vscode from 'vscode';

import { reportError } from '../shared/timing';
import type { Services } from './services';

/**
 * One feature's registrations: its commands, handed the services they use.
 * A feature registers; it builds nothing that outlives its commands, since
 * `createServices` has built that already.
 */
export type Feature = (context: vscode.ExtensionContext, services: Services) => void | Promise<void>;

/** A feature, named for the log when it fails. */
export interface NamedFeature {
  name: string;
  register: Feature;
}

/**
 * Runs each feature in order, so that a broken one costs its own commands
 * rather than the whole activation.
 *
 * A feature that throws, or whose promise rejects, is written to Deckard's
 * log and the next one still runs. Each runs synchronously, one after the
 * other, so every command a synchronous feature registers exists by the time
 * activate() returns, as it always did; a feature's promise is not waited
 * for, only watched for its failure.
 */
export function runFeatures(
  features: readonly NamedFeature[],
  context: vscode.ExtensionContext,
  services: Services,
): void {
  for (const { name, register } of features) {
    try {
      const result = register(context, services);
      result?.catch((error: unknown) => reportFailure(name, error));
    } catch (error) {
      reportFailure(name, error);
    }
  }
}

/** Writes a feature's failure to Deckard's log. */
function reportFailure(name: string, error: unknown): void {
  reportError(`Deckard could not register ${name}`, error);
}

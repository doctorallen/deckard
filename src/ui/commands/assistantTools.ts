import * as vscode from 'vscode';

import { measure } from '../../core/timing';
import { WorkspaceIndex } from '../../core/types';
import {
  answerQuery,
  answerTags,
  QUERY_TOOL_NAME,
  readQueryToolInput,
  readTagsToolInput,
  TAGS_TOOL_NAME,
} from '../state/assistantTools';

interface IndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
}

/**
 * Registers Deckard's language model tools, which let AI assistants in VS
 * Code, such as GitHub Copilot's agent mode, search notes and tasks with a
 * Deckard query and list tags.
 *
 * The tools only read the local index. What they return goes to the
 * assistant that called them, so `deckard.assistantTools` can turn them off.
 */
export class AssistantTools implements vscode.Disposable {
  private readonly registrations: vscode.Disposable[];

  public constructor(private readonly indexer: IndexSource) {
    this.registrations = [
      vscode.lm.registerTool<unknown>(QUERY_TOOL_NAME, {
        prepareInvocation: (options) => ({
          invocationMessage: `Searching Deckard notes and tasks: ${shorten(
            readQueryToolInput(options.input)?.query ?? '',
          )}`,
        }),
        invoke: (options) =>
          this.answer('Assistant query', () => {
            const input = readQueryToolInput(options.input);
            return input
              ? answerQuery(this.indexer.getSnapshot(), input)
              : 'Send a Deckard query as "query", such as tag = #project/atlas AND task = open.';
          }),
      }),
      vscode.lm.registerTool<unknown>(TAGS_TOOL_NAME, {
        prepareInvocation: (options) => {
          const search = readTagsToolInput(options.input).search?.trim();
          return {
            invocationMessage: search
              ? `Listing Deckard tags matching ${shorten(search)}`
              : 'Listing Deckard tags',
          };
        },
        invoke: (options) =>
          this.answer('Assistant tag list', () =>
            answerTags(
              this.indexer.getSnapshot(),
              readTagsToolInput(options.input),
            ),
          ),
      }),
    ];
  }

  public dispose(): void {
    this.registrations.forEach((registration) => registration.dispose());
  }

  /**
   * Waits for the first scan, so an early call never answers from a partial
   * index, and times the answer in Deckard's log.
   */
  private async answer(
    operation: string,
    respond: () => string,
  ): Promise<vscode.LanguageModelToolResult> {
    if (!areToolsEnabled()) {
      return textResult(
        "Deckard's assistant tools are turned off. The deckard.assistantTools setting turns them on.",
      );
    }
    await this.indexer.ready;
    return textResult(
      measure(operation, respond, (text) => `${text.length} characters`),
    );
  }
}

function areToolsEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('deckard')
    .get<boolean>('assistantTools', true);
}

function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(text),
  ]);
}

function shorten(text: string): string {
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

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

type RegisterTool = (
  name: string,
  tool: vscode.LanguageModelTool<unknown>,
) => vscode.Disposable;

/**
 * Registers Deckard's language model tools, which let AI assistants in VS
 * Code, such as GitHub Copilot's agent mode, search notes and tasks with a
 * Deckard query and list tags.
 *
 * The tools only read the local index, but what they return goes to the
 * assistant that called them, which may send it to its model service. So the
 * first call in each session asks the user first, and `deckard.assistantTools`
 * turns the tools off.
 */
export class AssistantTools implements vscode.Disposable {
  /** The tools as registered, so tests can call them without a chat. */
  public readonly queryTool: vscode.LanguageModelTool<unknown>;
  public readonly tagsTool: vscode.LanguageModelTool<unknown>;
  private readonly registrations: vscode.Disposable[];
  /** Whether the user has let an assistant read notes in this session. */
  private allowed = false;

  public constructor(
    private readonly indexer: IndexSource,
    register: RegisterTool = (name, tool) => vscode.lm.registerTool(name, tool),
  ) {
    this.queryTool = {
      prepareInvocation: (options) =>
        this.prepare(
          `Searching Deckard notes and tasks: ${shorten(
            readQueryToolInput(options.input)?.query ?? '',
          )}`,
        ),
      invoke: (options) =>
        this.answer('Assistant query', () => {
          const input = readQueryToolInput(options.input);
          return input
            ? answerQuery(this.indexer.getSnapshot(), input)
            : 'Send a Deckard query as "query", such as tag = #project/atlas AND task = open.';
        }),
    };
    this.tagsTool = {
      prepareInvocation: (options) => {
        const search = readTagsToolInput(options.input).search?.trim();
        return this.prepare(
          search
            ? `Listing Deckard tags matching ${shorten(search)}`
            : 'Listing Deckard tags',
        );
      },
      invoke: (options) =>
        this.answer('Assistant tag list', () =>
          answerTags(
            this.indexer.getSnapshot(),
            readTagsToolInput(options.input),
          ),
        ),
    };
    this.registrations = [
      register(QUERY_TOOL_NAME, this.queryTool),
      register(TAGS_TOOL_NAME, this.tagsTool),
    ];
  }

  public dispose(): void {
    this.registrations.forEach((registration) => registration.dispose());
  }

  /**
   * The progress message, and a confirmation until the user has allowed the
   * tools once this session. VS Code only calls `invoke` after the user
   * continues, so the first answer marks the session as allowed.
   */
  private prepare(invocationMessage: string): vscode.PreparedToolInvocation {
    if (this.allowed || !areToolsEnabled()) {
      return { invocationMessage };
    }
    return {
      invocationMessage,
      confirmationMessages: {
        title: 'Let the assistant read your notes?',
        message: new vscode.MarkdownString(
          'Deckard will give the assistant matching notes and tasks from this workspace, and the assistant may send them to its model service. Deckard asks once per session, and the `deckard.assistantTools` setting turns these tools off.',
        ),
      },
    };
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
    this.allowed = true;
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

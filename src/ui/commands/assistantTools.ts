import * as vscode from 'vscode';

import { measure, measureAsync } from '../../core/timing';
import { WorkspaceIndex } from '../../core/types';
import {
  answerQuery,
  answerTags,
  QUERY_TOOL_NAME,
  readQueryToolInput,
  readTagsToolInput,
  TAGS_TOOL_NAME,
} from '../state/assistantTools';
import {
  ADD_TASK_TOOL_NAME,
  addTask,
  CHANGE_TASK_TOOL_NAME,
  changeTask,
  readAddTaskInput,
  readChangeTaskInput,
  WriteAnswer,
} from './assistantWrites';

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
  public readonly addTaskTool: vscode.LanguageModelTool<unknown>;
  public readonly changeTaskTool: vscode.LanguageModelTool<unknown>;
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
    // The write tools ask every time, not once a session: a read shows the
    // assistant what is there, a write changes it, and the reader sees the
    // exact line in the refactor preview before it lands as well.
    this.addTaskTool = {
      prepareInvocation: (options) => {
        const input = readAddTaskInput(options.input);
        return this.prepareWrite(
          input
            ? `Adding a task${input.note ? ` to ${input.note}` : " to today's note"}: ${shorten(input.text)}`
            : 'Adding a task',
        );
      },
      invoke: (options) =>
        this.write('Assistant add task', () => {
          const input = readAddTaskInput(options.input);
          return input
            ? addTask(this.indexer, input)
            : Promise.resolve({
                text: 'Send the task\'s words as "text", and optionally a workspace-relative "note" to add it to; today\'s note otherwise.',
                isError: true,
              });
        }),
    };
    this.changeTaskTool = {
      prepareInvocation: (options) => {
        const input = readChangeTaskInput(options.input);
        return this.prepareWrite(
          input
            ? `Changing the task at ${input.note} line ${input.line}`
            : 'Changing a task',
        );
      },
      invoke: (options) =>
        this.write('Assistant change task', () => {
          const input = readChangeTaskInput(options.input);
          return input
            ? changeTask(this.indexer, input)
            : Promise.resolve({
                text: 'Send the task\'s "note" and "line" as deckard_query reports them, and at least one of: title, complete, due (YYYY-MM-DD or null), priority (highest, high, medium, low, lowest, or null), assignee (a person tag, or null).',
                isError: true,
              });
        }),
    };
    this.registrations = [
      register(QUERY_TOOL_NAME, this.queryTool),
      register(TAGS_TOOL_NAME, this.tagsTool),
      register(ADD_TASK_TOOL_NAME, this.addTaskTool),
      register(CHANGE_TASK_TOOL_NAME, this.changeTaskTool),
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
  /** A write asks every time: the confirmation is the tool's, the preview is the write's. */
  private prepareWrite(invocationMessage: string): vscode.PreparedToolInvocation {
    if (!areToolsEnabled()) {
      return { invocationMessage };
    }
    return {
      invocationMessage,
      confirmationMessages: {
        title: 'Let the assistant change a note?',
        message: new vscode.MarkdownString(
          `${invocationMessage}. Deckard will show the exact line in a preview before anything is written, and \`Deckard: Undo Last Change\` takes it back.`,
        ),
      },
    };
  }

  /** Runs a write once the tools are on and the index is ready, and answers with its result. */
  private async write(
    operation: string,
    run: () => Promise<WriteAnswer>,
  ): Promise<vscode.LanguageModelToolResult> {
    if (!areToolsEnabled()) {
      return textResult(
        "Deckard's assistant tools are turned off. The deckard.assistantTools setting turns them on.",
      );
    }
    this.allowed = true;
    await this.indexer.ready;
    const answer = await measureAsync(operation, run);
    return textResult(answer.text);
  }

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

export function areToolsEnabled(): boolean {
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

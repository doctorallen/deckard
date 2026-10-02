import * as vscode from 'vscode';

import { measure, measureAsync } from '../../shared/timing';
import { WorkspaceIndex } from '../../core/types';
import {
  ASSISTANT_TOOLS,
  AssistantTool,
  QUERY_TOOL_NAME,
  TAGS_TOOL_NAME,
  ToolAnswer,
  ToolRunners,
} from '../state/assistantTools';
import {
  ADD_TASK_TOOL_NAME,
  addTask,
  CHANGE_TASK_TOOL_NAME,
  changeTask,
} from './assistantWrites';
import { readQueryContext } from './queryContext';
import { WorkspaceWriteHistory } from './workspaceWrites';

interface IndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
}

type RegisterTool = (
  name: string,
  tool: vscode.LanguageModelTool<unknown>,
) => vscode.Disposable;

/** What a tool says when `deckard.assistantTools` has turned the tools off. */
const TOOLS_OFF =
  "Deckard's assistant tools are turned off. The \"Assistant Tools\" setting in Deckard's settings turns them on.";

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

  /**
   * Registers the four tools with VS Code (or with `register`, in a test).
   * Each answers only while `deckard.assistantTools` is on and the user has
   * agreed to it.
   */
  public constructor(
    private readonly indexer: IndexSource,
    /** The history the add-task and change-task tools write to. */
    private readonly history: WorkspaceWriteHistory,
    register: RegisterTool = (name, tool) => vscode.lm.registerTool(name, tool),
  ) {
    const runners: ToolRunners = {
      getSnapshot: () => this.indexer.getSnapshot(),
      readQueryContext: () => readQueryContext(),
      addTask: (input) => addTask(this.indexer, this.history, input),
      changeTask: (input) => changeTask(this.indexer, this.history, input),
    };
    const tools = new Map(
      ASSISTANT_TOOLS.map((tool) => [tool.name, this.adapt(tool, runners)] as const),
    );
    this.queryTool = toolNamed(tools, QUERY_TOOL_NAME);
    this.tagsTool = toolNamed(tools, TAGS_TOOL_NAME);
    this.addTaskTool = toolNamed(tools, ADD_TASK_TOOL_NAME);
    this.changeTaskTool = toolNamed(tools, CHANGE_TASK_TOOL_NAME);
    this.registrations = [...tools].map(([name, tool]) => register(name, tool));
  }

  /** Unregisters the four tools. */
  public dispose(): void {
    this.registrations.forEach((registration) => registration.dispose());
  }

  /**
   * One table entry as a language-model tool. A read asks once a session and
   * a write asks every time: a read shows the assistant what is there, a
   * write changes it, and the reader sees the exact line in the refactor
   * preview before it lands as well.
   */
  private adapt(
    tool: AssistantTool,
    runners: ToolRunners,
  ): vscode.LanguageModelTool<unknown> {
    if (tool.kind === 'read') {
      return {
        prepareInvocation: (options) => this.prepare(tool.progressMessage(options.input)),
        invoke: (options) =>
          this.answer(tool.measure.languageModel, () => {
            const call = tool.read(options.input, runners);
            return call.kind === 'run' ? call.run() : call.text.languageModel;
          }),
      };
    }
    return {
      prepareInvocation: (options) => this.prepareWrite(tool.progressMessage(options.input)),
      invoke: (options) =>
        this.write(tool.measure.languageModel, () => {
          const call = tool.read(options.input, runners);
          return call.kind === 'run'
            ? call.run()
            : Promise.resolve({ text: call.text.languageModel, isError: true });
        }),
    };
  }

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
  private write(
    operation: string,
    run: () => Promise<ToolAnswer>,
  ): Promise<vscode.LanguageModelToolResult> {
    return this.guarded(async () => (await measureAsync(operation, run)).text);
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
          'Deckard will give the assistant matching notes and tasks from this workspace, and the assistant may send them to its model service. Deckard asks once per session, and the "Assistant Tools" setting in Deckard\'s settings turns these tools off.',
        ),
      },
    };
  }

  /** Answers a read, timed in Deckard's log with the answer's length. */
  private answer(
    operation: string,
    respond: () => string,
  ): Promise<vscode.LanguageModelToolResult> {
    return this.guarded(() =>
      measure(operation, respond, (text) => `${text.length} characters`),
    );
  }

  /**
   * Refuses while the tools are turned off; otherwise marks the session as
   * allowed and waits for the first scan, so an early call never answers
   * from a partial index.
   */
  private async guarded(
    respond: () => string | Promise<string>,
  ): Promise<vscode.LanguageModelToolResult> {
    if (!areToolsEnabled()) {
      return textResult(TOOLS_OFF);
    }
    this.allowed = true;
    await this.indexer.ready;
    return textResult(await respond());
  }
}

/** A tool the table must hold; the four names are the table's own. */
function toolNamed(
  tools: ReadonlyMap<string, vscode.LanguageModelTool<unknown>>,
  name: string,
): vscode.LanguageModelTool<unknown> {
  const tool = tools.get(name);
  if (!tool) {
    throw new Error(`Deckard has no assistant tool named ${name}.`);
  }
  return tool;
}

/** Whether `deckard.assistantTools` leaves the language-model tools on. */
export function areToolsEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('deckard')
    .get<boolean>('assistantTools', true);
}

/** A tool result holding one text part. */
function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(text),
  ]);
}

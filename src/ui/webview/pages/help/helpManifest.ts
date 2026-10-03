/**
 * Help's reading of the extension's own manifest: which Deckard commands it
 * names, which of them it may run, and the shortcut beside each. The host
 * checks a page's `runCommand` against `isRunnableFromHelp` before running
 * anything, and Help's HTML is built from the same reading.
 */
import { escapeHtml } from '../../../../shared/html';

/**
 * What the Help page reads from the extension's own manifest.
 *
 * The commands and settings tables are built from what Deckard actually
 * contributes rather than from a copy of it, so a feature cannot ship with
 * the guide still describing the workspace before it.
 */
export interface HelpManifest {
  commands?: { command: string; title: string; category?: string }[];
  configuration?: {
    title?: string;
    properties?: Record<
      string,
      { default?: unknown; description?: string; markdownDescription?: string }
    >;
  }[];
  keybindings?: { command: string; key?: string; mac?: string; when?: string }[];
  menus?: { commandPalette?: { command: string; when?: string }[] };
}

/** A Deckard command as Help names it, and whether Help can run it. */
export interface HelpCommand {
  command: string;
  /** Runs from Help: it needs no note in the editor, and the palette offers it. */
  runnable: boolean;
  binding?: { key: string; mac?: string };
}

/** A palette `when` that needs a note in the editor to act on. */
const EDITOR_CONTEXT = /\beditorLangId\b|\beditorTextFocus\b|\bdeckard\.onTaskLine\b|\bdeckard\.isNote\b/;

/**
 * Every Deckard command by its title, with whether Help may run it: a
 * command the palette hides, or one that acts on the note in the editor,
 * would have nothing to act on from Help.
 */
export function describeHelpCommands(manifest: HelpManifest): Map<string, HelpCommand> {
  const when = new Map(
    (manifest.menus?.commandPalette ?? []).map((entry) => [entry.command, entry.when]),
  );
  const bindings = new Map(
    (manifest.keybindings ?? [])
      .filter((binding) => binding.key)
      .map((binding) => [binding.command, { key: binding.key!, ...(binding.mac ? { mac: binding.mac } : {}) }]),
  );
  const commands = new Map<string, HelpCommand>();
  for (const command of manifest.commands ?? []) {
    if (command.category !== 'Deckard' || commands.has(command.title)) {
      continue;
    }
    const condition = when.get(command.command);
    const binding = bindings.get(command.command);
    commands.set(command.title, {
      command: command.command,
      runnable: condition !== 'false' && !EDITOR_CONTEXT.test(condition ?? ''),
      ...(binding ? { binding } : {}),
    });
  }
  return commands;
}

/** Whether a message from the Help page may run this command. */
export function isRunnableFromHelp(manifest: HelpManifest, command: string): boolean {
  return [...describeHelpCommands(manifest).values()].some(
    (candidate) => candidate.runnable && candidate.command === command,
  );
}

/** A key binding as this platform writes it: Cmd+Shift+Alt+F. */
export function formatShortcut(
  binding: { key: string; mac?: string },
  platform: NodeJS.Platform,
): string {
  const keys = platform === 'darwin' ? binding.mac ?? binding.key : binding.key;
  return keys
    .split('+')
    .map((part) => (part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join('+');
}

/** A command's name as a button that runs it, or as code where it cannot. */
export function renderCommandName(
  label: string,
  command: HelpCommand | undefined,
  platform: NodeJS.Platform,
): string {
  const name = command?.runnable
    ? `<button type="button" class="command-link" data-command="${escapeHtml(command.command)}">${label}</button>`
    : `<code>${label}</code>`;
  return command?.binding
    ? `${name} <kbd class="shortcut">${escapeHtml(formatShortcut(command.binding, platform))}</kbd>`
    : name;
}

/**
 * Turns every `<code>Deckard: Title</code>` in the page's prose into the
 * command's button, with its shortcut beside it. A name the manifest does not
 * contribute is left as it was, and the Help test fails on it.
 */
export function linkCommandNames(
  html: string,
  commands: ReadonlyMap<string, HelpCommand>,
  platform: NodeJS.Platform,
): string {
  return html.replace(/<code>Deckard: ([^<]+)<\/code>/g, (whole, title: string) => {
    const command = commands.get(title.replace(/&amp;/g, '&').replace(/’/g, "'"));
    return command ? renderCommandName(`Deckard: ${title}`, command, platform) : whole;
  });
}

/**
 * Help's reading of the extension's own manifest: which Deckard commands
 * the guide names, and which of them Help may run. The host checks a page's
 * `runCommand` against `isRunnableFromHelp` before running anything, and
 * turns the names in a guide page into buttons from the same reading.
 */
import { escapeHtml } from '../../../../shared/html';

/**
 * What the Help page reads from the extension's own manifest: the commands
 * Deckard actually contributes, and where the palette offers each, so a
 * command the guide names runs from Help only when it can.
 */
export interface HelpManifest {
  commands?: { command: string; title: string; category?: string }[];
  menus?: { commandPalette?: { command: string; when?: string }[] };
}

/** A Deckard command as Help names it, and whether Help can run it. */
export interface HelpCommand {
  command: string;
  /** Runs from Help: it needs no note in the editor, and the palette offers it. */
  runnable: boolean;
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
  const commands = new Map<string, HelpCommand>();
  for (const command of manifest.commands ?? []) {
    if (command.category !== 'Deckard' || commands.has(command.title)) {
      continue;
    }
    const condition = when.get(command.command);
    commands.set(command.title, {
      command: command.command,
      runnable: condition !== 'false' && !EDITOR_CONTEXT.test(condition ?? ''),
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

/**
 * Turns every command the guide names, as `<code>Deckard: Title</code>` or
 * `<strong>Deckard: Title</strong>`, into a button that runs it, when Help
 * may run it. One Help may not run, such as one that acts on the note in
 * the editor, is left as it was written, and so is a name the manifest
 * does not contribute, which the guide test fails on.
 */
export function linkCommandNames(html: string, commands: ReadonlyMap<string, HelpCommand>): string {
  return html.replace(/<(code|strong)>Deckard: ([^<]+)<\/\1>/g, (whole, _tag: string, title: string) => {
    const command = commands.get(title.replace(/&amp;/g, '&').replace(/&#x27;|&#39;|’/g, "'"));
    return command?.runnable
      ? `<button type="button" class="command-link" data-command="${escapeHtml(command.command)}">Deckard: ${title}</button>`
      : whole;
  });
}

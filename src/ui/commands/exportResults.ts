import * as vscode from 'vscode';

import { EXPORT_FORMATS, ExportFormat } from '../../domain/export/exportFormats';
import type { ExportPlan } from '../../services/exportService';

/**
 * Exporting a page's results: asking how and where, and copying or saving
 * what ExportService planned. The rows and the text each format makes of
 * them are in `domain/export`.
 */

/** A format, and whether it is copied or saved. */
export interface ExportChoice {
  format: ExportFormat;
  /** Copy to the clipboard, or save to a file the reader chooses. */
  to: 'clipboard' | 'file';
}

/** Copy as live query block: the one choice that is not a format. */
export const LIVE_QUERY_BLOCK_LABEL = 'Copy as live query block';

/** One entry of {@link EXPORT_FORMATS}. */
type FormatEntry = (typeof EXPORT_FORMATS)[number];

/** How the reader chose to export: the live block, or a format copied or saved. */
type HowToExport = { kind: 'live' } | { kind: 'format'; to: ExportChoice['to']; entry: FormatEntry };

/** A row of the export list, and the choice it stands for. */
type ExportPick = vscode.QuickPickItem & { how: HowToExport };

/**
 * Presents an export ExportService planned: says there is nothing to
 * export, or asks how and where and copies or saves the results. The text
 * is made only once the reader has chosen.
 *
 * A live block makes the first choice a query block of the search, which a
 * note keeps up to date: `liveBlock` when given, else the plan's. A page
 * gives its own when the block carries the page's sort or layout, which
 * the plan's does not.
 */
export async function presentExport(
  plan: ExportPlan,
  liveBlock?: () => string,
): Promise<void> {
  if (plan.kind === 'nothing') {
    void vscode.window.showInformationMessage(`There are no ${plan.what} to export.`);
    return;
  }
  const live = liveBlock ?? plan.liveBlock;
  const how = await askHowToExport(plan.count, plan.what, live !== undefined);
  if (!how) {
    return;
  }
  if (how.kind === 'live') {
    await copyLiveBlock(live);
    return;
  }
  const body = plan.text(how.entry.format);
  if (how.to === 'clipboard') {
    await copyText(body, `${plan.count} ${plan.what} as ${how.entry.label}`);
    return;
  }
  await saveText(body, { what: plan.what, count: plan.count, extension: how.entry.extension });
}

/**
 * Asks how to export `count` results: the live block first when there is
 * one, then each format, copied or saved. Undefined when the list is closed.
 */
async function askHowToExport(
  count: number,
  what: string,
  hasLive: boolean,
): Promise<HowToExport | undefined> {
  const live: ExportPick[] = hasLive
    ? [{ label: LIVE_QUERY_BLOCK_LABEL, description: 'Stays up to date', how: { kind: 'live' } }]
    : [];
  const picked = await vscode.window.showQuickPick<ExportPick>(
    [
      ...live,
      ...EXPORT_FORMATS.flatMap((entry): ExportPick[] => [
        { label: `Copy as ${entry.label}`, description: entry.detail, how: { kind: 'format', to: 'clipboard', entry } },
        { label: `Save as ${entry.label}…`, description: entry.detail, how: { kind: 'format', to: 'file', entry } },
      ]),
    ],
    { title: `Export ${count} ${what}`, placeHolder: 'Everything the search found, not only the page on screen' },
  );
  return picked?.how;
}

/** Copies the live query block, and says what to do with it. */
async function copyLiveBlock(liveBlock: (() => string) | undefined): Promise<void> {
  await vscode.env.clipboard.writeText(liveBlock ? liveBlock() : '');
  vscode.window.setStatusBarMessage(
    "$(check) Copied a live query block. Paste it into a note to keep this search's results there.",
    5000,
  );
}

/** Copies `body`, and says what was copied, as `copied` words it. */
async function copyText(body: string, copied: string): Promise<void> {
  await vscode.env.clipboard.writeText(body);
  // A copy has nothing to follow up, so it is said in the status bar, where
  // it fades, rather than in a notification that waits to be closed.
  vscode.window.setStatusBarMessage(`$(check) Copied ${copied}`, 5000);
}

/** Asks where to save `body`, saves it there, and offers to open it. */
async function saveText(
  body: string,
  file: { what: string; count: number; extension: string },
): Promise<void> {
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`deckard-${file.what}.${file.extension}`),
    filters: file.extension === 'csv' ? { CSV: ['csv'] } : { Markdown: ['md'] },
    title: `Save ${file.count} ${file.what}`,
  });
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'utf8'));
  // A saved file is worth a notification only for the way to open it.
  void vscode.window
    .showInformationMessage(`Saved ${file.count} ${file.what} to ${target.fsPath}.`, 'Open')
    .then((choice) => {
      if (choice !== 'Open') {
        return;
      }
      void vscode.window.showTextDocument(target, { preview: false });
    });
}

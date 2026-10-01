import * as vscode from 'vscode';

import { stripTags } from '../../domain/markdown/parser';
import { PreferencesReader } from '../../core/storage/preferences';
import { PersistedPreferences, Section, WorkspaceIndex } from '../../core/types';
import { getHeadingPath } from '../state/dashboardState';
import { frecencyScore } from '../state/frecency';
import { findPinnedSection } from '../state/pinnedNotes';
import { showQuickPickUntilHidden } from './prompts';

/**
 * Where Capture Under a Heading and Move to… put something: a heading, and
 * for Move to…, today's note or a new note. One list for both, so the
 * headings they went under last come first in each.
 */
export type Destination =
  | { kind: 'heading'; filePath: string; section: Section }
  | { kind: 'today' }
  | { kind: 'newNote' };

export interface DestinationItem extends vscode.QuickPickItem {
  destination?: Destination;
}

export interface DestinationOptions {
  /** Offer today's note, named by its file. */
  today?: { fileName: string };
  /** Offer a new note. */
  newNote?: boolean;
  /** Headings not to offer, such as the ones a moved block holds. */
  exclude?: (section: Section) => boolean;
  now?: number;
}

const DAY_ICON = '$(calendar)';

/**
 * The list: New note… and Today's note when offered, then the headings used
 * last, newest first, then every heading, from the notes opened most and
 * most lately, then the notes updated last.
 */
export function buildDestinationItems(
  index: WorkspaceIndex,
  preferences: Partial<Pick<PersistedPreferences, 'recentHeadings' | 'sectionAccessCounts' | 'sectionAccessTimes'>>,
  options: DestinationOptions = {},
): DestinationItem[] {
  const now = options.now ?? Date.now();
  const items: DestinationItem[] = [];
  const excluded = options.exclude ?? (() => false);
  if (options.newNote) {
    items.push({ label: '$(new-file) New note…', destination: { kind: 'newNote' } });
  }
  if (options.today) {
    items.push({
      label: `${DAY_ICON} Today’s note`,
      description: options.today.fileName,
      destination: { kind: 'today' },
    });
  }
  const headingItem = (section: Section): DestinationItem => {
    const path = getHeadingPath(section, index.sections);
    return {
      label: stripTags(section.heading).trim() || section.heading,
      description: section.filePath,
      detail: path.length > 1 ? path.join(' › ') : undefined,
      destination: { kind: 'heading', filePath: section.filePath, section },
    };
  };

  const listed = new Set<string>();
  const recent = (preferences.recentHeadings ?? []).flatMap((pin) => {
    const file = index.files.get(pin.filePath);
    const section = file && pin.heading ? findPinnedSection(file.sections, pin) : undefined;
    if (!section || excluded(section) || listed.has(section.id)) {
      return [];
    }
    listed.add(section.id);
    return [headingItem(section)];
  });
  if (recent.length > 0) {
    items.push({ label: 'Recent', kind: vscode.QuickPickItemKind.Separator }, ...recent);
  }

  const noteScore = new Map<string, number>();
  index.sections.forEach((section) => {
    const score = frecencyScore(
      preferences.sectionAccessCounts?.[section.id] ?? 0,
      preferences.sectionAccessTimes?.[section.id],
      now,
    );
    noteScore.set(section.filePath, Math.max(noteScore.get(section.filePath) ?? 0, score));
  });
  const files = [...index.files.values()].sort(
    (left, right) =>
      (noteScore.get(right.filePath) ?? 0) - (noteScore.get(left.filePath) ?? 0) ||
      (right.updatedAt ?? 0) - (left.updatedAt ?? 0) ||
      left.filePath.localeCompare(right.filePath),
  );
  const all = files.flatMap((file) =>
    file.sections
      .filter((section) => !section.isInline && !listed.has(section.id) && !excluded(section))
      .sort((left, right) => left.startLine - right.startLine)
      .map(headingItem),
  );
  if (all.length > 0) {
    items.push(
      { label: recent.length > 0 ? 'All headings' : 'Headings', kind: vscode.QuickPickItemKind.Separator },
      ...all,
    );
  }
  return items;
}

/**
 * Asks where something goes. The heading used last is highlighted when
 * there is one, so Enter repeats it.
 */
export function pickDestination(
  index: WorkspaceIndex,
  preferences: Pick<PreferencesReader, 'value'> | undefined,
  options: DestinationOptions & { title: string; placeholder: string },
): Promise<Destination | undefined> {
  const items = buildDestinationItems(index, preferences?.value ?? {}, options);
  if (!items.some((item) => item.destination)) {
    void vscode.window.showInformationMessage('There are no headings in your notes yet.');
    return Promise.resolve(undefined);
  }
  return showQuickPickUntilHidden<DestinationItem, Destination>({
    configure: (picker) => {
      picker.title = options.title;
      picker.placeholder = options.placeholder;
      picker.matchOnDescription = true;
      picker.items = items;
      const firstRecent = items.findIndex((item) => item.label === 'Recent');
      if (firstRecent >= 0 && items[firstRecent + 1]) {
        picker.activeItems = [items[firstRecent + 1]];
      }
    },
    accept: (picker) => picker.activeItems[0]?.destination,
    stayOpenWithoutAnswer: true,
  });
}

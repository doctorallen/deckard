import picomatch = require('picomatch');

import { parseMarkdown } from '../domain/markdown/parser';
import { ParsedFile, WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { computeParked, ParkedRules, toParkedTagKey } from '../domain/index/parked';

/** Rules as the settings would give them: tags as written, folder globs. */
export function parkedRules(options: { tags?: string[]; folders?: string[] } = {}): ParkedRules {
  const folders = options.folders ?? [];
  const isMatch = folders.length > 0 ? picomatch(folders, { dot: true }) : undefined;
  return {
    hasFolders: folders.length > 0,
    tags: (options.tags ?? ['parked'])
      .map(toParkedTagKey)
      .filter((key): key is string => key !== undefined),
    isParkedPath: (filePath) => {
      const segments = filePath.split('/');
      return (
        isMatch !== undefined &&
        segments.some((_, index) => isMatch(segments.slice(0, index + 1).join('/')))
      );
    },
  };
}

/** Parses the notes, builds the index, and marks what the rules park. */
export function indexWithParking(
  notes: Record<string, string>,
  options: { tags?: string[]; folders?: string[]; now?: number } = {},
): WorkspaceIndex {
  const files = new Map<string, ParsedFile>();
  Object.entries(notes).forEach(([filePath, content]) =>
    files.set(
      filePath,
      parseMarkdown(filePath, content, { createdAt: options.now ?? 0, updatedAt: options.now ?? 0 }),
    ),
  );
  const index = buildWorkspaceIndex(files);
  index.parked = computeParked(index, parkedRules(options));
  return index;
}

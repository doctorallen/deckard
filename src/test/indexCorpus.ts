import * as fs from 'fs';
import * as path from 'path';

import { parseMarkdown } from '../core/markdown/parser';
import { ParsedFile, WorkspaceIndex } from '../core/types';

/**
 * Notes for the index equivalence tests: the sample workspace, the repo's own
 * development notes, a hand-written corpus of the index's edge cases, and a
 * seeded generator of random notes and random edits to them.
 */

const repositoryRoot = path.join(__dirname, '..', '..');

/** A seeded random source, so a failing run can be repeated exactly. */
export function createRandom(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) {
    state += 2147483646;
  }
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}

/** Parses notes as the scanner does, with dates that tell them apart. */
export function parseNotes(notes: ReadonlyArray<[string, string]>): ParsedFile[] {
  return notes.map(([filePath, text], index) =>
    parseMarkdown(filePath, text, {
      createdAt: Date.UTC(2026, 0, 1) + index * 86400000,
      updatedAt: Date.UTC(2026, 6, 1) + index * 3600000,
    }),
  );
}

/** The sample workspace Deckard installs, with its dates filled in. */
export function sampleNotes(): Array<[string, string]> {
  const folder = path.join(repositoryRoot, 'resources', 'sample');
  return fs
    .readdirSync(folder)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => [
      name,
      fs
        .readFileSync(path.join(folder, name), 'utf8')
        .replace(/\{\{date([+-]\d+)?\}\}/g, (_, offset: string | undefined) =>
          `2026-09-${String(20 + Number(offset ?? 0)).padStart(2, '0')}`,
        ),
    ]);
}

/** The repository's own development notes: real daily and weekly notes. */
export function developmentNotes(): Array<[string, string]> {
  const folder = path.join(repositoryRoot, 'development', 'notes');
  if (!fs.existsSync(folder)) {
    return [];
  }
  return fs
    .readdirSync(folder)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => [`development/notes/${name}`, fs.readFileSync(path.join(folder, name), 'utf8')]);
}

/** Every case the fold has to agree with the direct pass on, by hand. */
export function edgeCaseNotes(): Array<[string, string]> {
  return [
    ['hubs/atlas.md', '---\ndescribes: [project/atlas, topic/maps]\nowner: "@dana"\n---\n# Atlas hub\nAbout the project.'],
    ['hubs/atlas-too.md', '---\ndescribes: [project/atlas, project/atlas]\n---\n# Another hub #project/atlas'],
    ['front-matter-only.md', '---\ntags: [area/home, person/dana]\naliases: [Home base]\n---\nNo headings, just words and [[atlas]].'],
    ['front-and-content.md', '---\ntags: [project/atlas, topic/other]\n---\n# Heading #project/atlas\n- [ ] Task #topic/other'],
    ['deep.md', [
      '# Top #project/atlas #area/work',
      '## Middle #topic/maps',
      '### Bottom #topic/detail #project/atlas',
      'A line with #topic/inline and #person/sable tags.',
      '- [ ] Nested task #topic/maps #person/dana',
      '#### Deeper, untagged',
      '##### Deepest #topic/deepest',
      '- [x] Done task #topic/deepest #topic/maps 📅 2026-09-01',
    ].join('\n')],
    ['spellings.md', '# One #Topic/Maps and #topic/maps\n- [ ] Case #TOPIC/MAPS #project/Atlas'],
    ['people.md', '# Meeting with @dana and @Sable #meeting/weekly\n- [ ] Follow up 👤 @dana #project/atlas\n- [ ] Ask @sable about #topic/maps'],
    ['2026-09-20.md', '# 2026-09-20\n- [ ] Daily task #project/atlas\nNotes of the day with [[deep]].'],
    ['week-2026-09-14-2026-09-20.md', '# Week review #area/work\n- [ ] Plan #topic/maps'],
    ['no-tags.md', '# Just a heading\nPlain prose, a [[link]], and nothing tagged.\n- [ ] Untagged task'],
    ['empty.md', ''],
    ['body-tags.md', '# Body #project/atlas\nFirst body line #topic/body\nSecond body line #topic/body #person/dana\n\n## Child\nChild text #topic/child'],
    ['groups.md', '# Groups\n- #a/one #a/two #a/three on one line\n- #a/two #a/three again\n- [ ] Task #a/one #a/three #a/one'],
    ['repeat-heading.md', '# Same #topic/maps\n## Same #topic/maps\n# Same #topic/maps'],
    ['org.md', '# Org #org/acme #organization/globex\n- [ ] Call #org/acme'],
  ];
}

const TAGS = [
  '#project/atlas', '#project/relay', '#Project/Atlas', '#topic/maps', '#topic/Maps',
  '#topic/detail', '#area/work', '#area/home', '#meeting/weekly', '#org/acme',
  '@dana', '@sable', '@Dana', '#person/dana', '#plain', '#Plain', '#a/one', '#a/two',
];

/** A random note: headings nested a few deep, tagged lines, tasks, links. */
export function randomNote(random: () => number, index: number, noteCount: number): string {
  const tags = () => {
    const count = Math.floor(random() * 4);
    return Array.from({ length: count }, () => pick(random, TAGS)).join(' ');
  };
  const lines: string[] = [];
  const roll = random();
  if (roll < 0.25) {
    const frontTags = Array.from({ length: 1 + Math.floor(random() * 2) }, () =>
      pick(random, TAGS).replace(/^#/, ''),
    );
    lines.push('---', `tags: [${frontTags.join(', ')}]`);
    if (random() < 0.3) {
      lines.push(`aliases: [Alias ${index}]`);
    }
    if (random() < 0.2) {
      lines.push(`describes: [${pick(random, TAGS).replace(/^#/, '')}]`);
    }
    lines.push('---');
  }
  const blocks = Math.floor(random() * 6);
  for (let block = 0; block < blocks; block += 1) {
    const kind = random();
    if (kind < 0.35) {
      lines.push(`${'#'.repeat(1 + Math.floor(random() * 4))} Heading ${index}.${block} ${tags()}`.trimEnd());
    } else if (kind < 0.6) {
      lines.push(`- [${random() < 0.3 ? 'x' : ' '}] Task ${index}.${block} ${tags()}${random() < 0.3 ? ' 📅 2026-10-0' + (1 + Math.floor(random() * 9)) : ''}`.trimEnd());
    } else if (kind < 0.8) {
      lines.push(`Line ${block} about [[n${Math.floor(random() * noteCount)}]] ${tags()}`.trimEnd());
    } else {
      lines.push(`Plain prose ${block} in note ${index}.`);
    }
  }
  return lines.join('\n');
}

export function randomNotes(seed: number, count: number): Array<[string, string]> {
  const random = createRandom(seed);
  return Array.from({ length: count }, (_, index) => [
    `notes/n${index}.md`,
    randomNote(random, index, count),
  ]);
}

/**
 * An index as plain data: every map as its entries in order, associations
 * read in full, and the build time left out. Order is compared, not sorted
 * away.
 */
export function normalizeIndex(index: WorkspaceIndex): unknown {
  const associations = index.tagAssociations
    ? [...index.tagAssociations.entries()].map(([key, list]) => [
        key,
        list.map((association) => {
          // The direct pass left its working set of units on each one.
          const copy: Record<string, unknown> = { ...association };
          delete copy.sourceUnitIds;
          return copy;
        }),
      ])
    : [];
  return {
    files: [...index.files.entries()],
    sections: [...index.sections.entries()],
    tasks: [...index.tasks.entries()],
    tags: [...index.tags.entries()],
    entities: [...index.entities.entries()],
    tagAssociations: associations,
  };
}

export function toFileMap(files: readonly ParsedFile[]): Map<string, ParsedFile> {
  return new Map(files.map((file) => [file.filePath, file]));
}

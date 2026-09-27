import * as fs from 'fs';
import * as path from 'path';

import { parseMarkdown } from '../core/markdown/parser';
import { ParsedFile, WorkspaceIndex } from '../core/types';
import { resolveSampleTokens, sampleFileName } from '../ui/commands/sampleWorkspace';

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

/**
 * The sample workspace Deckard installs, with its dates filled in from one
 * fixed day and its daily notes named as installed. The templates folder is
 * left out, as the scanner leaves it out.
 */
export function sampleNotes(): Array<[string, string]> {
  const root = path.join(repositoryRoot, 'resources', 'sample');
  const day = new Date(2026, 8, 20);
  const notes: Array<[string, string]> = [];
  const walk = (folder: string, prefix: string): void => {
    for (const name of fs.readdirSync(folder).sort()) {
      const full = path.join(folder, name);
      if (fs.statSync(full).isDirectory()) {
        if (name !== 'templates' && name !== 'dot-vscode') {
          walk(full, `${prefix}${name}/`);
        }
      } else if (name.endsWith('.md')) {
        notes.push([`${prefix}${sampleFileName(name, day)}`, resolveSampleTokens(fs.readFileSync(full, 'utf8'), day)]);
      }
    }
  };
  walk(root, '');
  return notes;
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
      // Now and then, steps under it: each is a task linked to this one.
      const steps = random() < 0.3 ? 1 + Math.floor(random() * 3) : 0;
      for (let step = 0; step < steps; step += 1) {
        lines.push(`  - [${random() < 0.4 ? 'x' : ' '}] Step ${index}.${block}.${step} ${tags()}`.trimEnd());
      }
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

/** One random edit to a note's text: a tag, heading, task, link, or alias. */
export function editNote(random: () => number, text: string, noteCount: number): string {
  const lines = text === '' ? [] : text.split('\n');
  const bodyStart = lines[0] === '---' ? lines.indexOf('---', 1) + 1 : 0;
  const at = () => bodyStart + Math.floor(random() * (lines.length - bodyStart + 1));
  const existing = () =>
    lines.length > bodyStart ? bodyStart + Math.floor(random() * (lines.length - bodyStart)) : -1;
  const edit = Math.floor(random() * 11);
  switch (edit) {
    case 0: {
      // Add a tag to a line.
      const line = existing();
      if (line >= 0) {
        lines[line] = `${lines[line]} ${pick(random, TAGS)}`;
      } else {
        lines.push(`Line ${pick(random, TAGS)}`);
      }
      break;
    }
    case 1: {
      // Remove a tag from a line.
      const line = existing();
      if (line >= 0) {
        lines[line] = lines[line].replace(/\s[#@][\w/]+/, '');
      }
      break;
    }
    case 2: {
      // Spell a tag another way.
      const line = existing();
      if (line >= 0) {
        lines[line] = lines[line].replace(/([#@])(\w)/, (_, mark: string, letter: string) =>
          mark + (letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase()),
        );
      }
      break;
    }
    case 3:
      lines.splice(at(), 0, `${'#'.repeat(1 + Math.floor(random() * 4))} Added heading ${pick(random, TAGS)}`);
      break;
    case 4:
      lines.splice(at(), 0, `- [ ] Added task ${pick(random, TAGS)} ${pick(random, TAGS)}`);
      break;
    case 5:
      lines.splice(at(), 0, `See [[n${Math.floor(random() * noteCount)}]] and ${pick(random, TAGS)}`);
      break;
    case 6: {
      // Remove a line: a heading, task, or anything else.
      const line = existing();
      if (line >= 0) {
        lines.splice(line, 1);
      }
      break;
    }
    case 7:
      // Change words only.
      lines.splice(at(), 0, 'Some new words.');
      break;
    case 8:
      // Tick or untick a task.
      return lines
        .join('\n')
        .replace(/- \[( |x)\]/, (_, mark: string) => (mark === ' ' ? '- [x]' : '- [ ]'));
    case 9: {
      // Front matter: aliases, hub `describes`, tags.
      const front = [
        '---',
        `tags: [${pick(random, TAGS).replace(/^#/, '')}]`,
        ...(random() < 0.5 ? [`aliases: [Alias ${Math.floor(random() * 9)}]`] : []),
        ...(random() < 0.5 ? [`describes: [${pick(random, TAGS).replace(/^#/, '')}]`] : []),
        '---',
      ];
      return [...front, ...lines.slice(bodyStart)].join('\n');
    }
    default:
      // Empty the note down to its front matter, or to nothing.
      return lines.slice(0, bodyStart).join('\n');
  }
  return lines.join('\n');
}

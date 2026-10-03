#!/usr/bin/env node
// Keeps CHANGELOG.md cut per release.
//
// Entries are written under `## Unreleased` as work lands. When a release is
// prepared, `cut` renames that section to the version and date, opens a fresh
// `## Unreleased` above it, and merges repeated `### Changed` (and the like)
// into one of each. The release workflow then reads the section back with
// `notes` for the GitHub release, so the Extensions view's Changelog tab and
// the release page say the same thing.
//
//   node scripts/changelog.js cut <version> <date> <baseVersion> [commitsFile]
//   node scripts/changelog.js notes <version>
//   node scripts/changelog.js check
'use strict';

const fs = require('fs');
const path = require('path');

/** The subsections in the order a release reads them; any others follow. */
const ORDER = ['Highlights', 'Added', 'Changed', 'Fixed'];
const VERSION_HEADING = /^## (\d+)\.(\d+)\.(\d+)(?: - (\d{4}-\d{2}-\d{2}))?\s*$/;

/** The text before the first `## `, and each `## ` section with its body. */
function splitSections(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const preamble = [];
  const sections = [];
  let current;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      current = { heading: line.trimEnd(), body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  return {
    preamble: preamble.join('\n'),
    sections: sections.map((section) => ({ heading: section.heading, body: section.body.join('\n') })),
  };
}

/** A version heading's numbers, or undefined for any other heading. */
function readVersion(heading) {
  const match = VERSION_HEADING.exec(heading);
  return match
    ? { version: [Number(match[1]), Number(match[2]), Number(match[3])], date: match[4] }
    : undefined;
}

/** A version's three numbers, refusing text that is not `major.minor.patch`. */
function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(text).trim());
  if (!match) {
    throw new Error(`Not a version: ${text}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Below zero when `left` is the earlier version, above when it is the later, and zero when they are the same. */
function compareVersions(left, right) {
  for (let at = 0; at < 3; at += 1) {
    if (left[at] !== right[at]) {
      return left[at] - right[at];
    }
  }
  return 0;
}

/**
 * A body's subsections, by name, in the order they are first met. Text
 * before any `### ` heading counts as Changed.
 */
function readSubsections(body, into = new Map()) {
  let name = 'Changed';
  let lines = [];
  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) {
      into.set(name, [...(into.get(name) || []), text]);
    }
    lines = [];
  };
  for (const line of body.split('\n')) {
    const heading = /^### (.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      name = heading[1];
    } else {
      lines.push(line);
    }
  }
  flush();
  return into;
}

/** Subsections written out, in release order. */
function writeSubsections(subsections) {
  const names = [
    ...ORDER.filter((name) => subsections.has(name)),
    ...[...subsections.keys()].filter((name) => !ORDER.includes(name)),
  ];
  return names
    .map((name) => `### ${name}\n\n${subsections.get(name).join('\n\n')}`)
    .join('\n\n');
}

/** Entries made from commit subjects: `feat:` is Added, `fix:` is Fixed. */
function entriesFromCommits(commits) {
  const subsections = new Map();
  for (const subject of commits) {
    const match = /^(feat|fix)(\([^)]*\))?!?:\s*(.+)$/.exec(String(subject).trim());
    if (!match) {
      continue;
    }
    const name = match[1] === 'feat' ? 'Added' : 'Fixed';
    const text = match[3].charAt(0).toUpperCase() + match[3].slice(1);
    subsections.set(name, [...(subsections.get(name) || []), `- ${text}`]);
  }
  subsections.forEach((entries, name) => subsections.set(name, [entries.join('\n')]));
  return subsections;
}

/**
 * The changelog with `## Unreleased`, and any version section newer than the
 * last release, cut into one section for `version`. A fresh, empty
 * `## Unreleased` is opened above it. With no entries written, the section is
 * made from the release's `feat:` and `fix:` commit subjects, so a release
 * never ships with no notes.
 */
function cutChangelog(text, { version, date, baseVersion, commits = [] }) {
  const base = parseVersion(baseVersion);
  const { preamble, sections } = splitSections(text);
  const folded = new Map();
  let insertAt = -1;
  const kept = [];
  sections.forEach((section) => {
    const read = readVersion(section.heading);
    const unreleased = section.heading === '## Unreleased';
    if (unreleased || (read && compareVersions(read.version, base) > 0)) {
      readSubsections(section.body, folded);
      if (insertAt < 0) {
        insertAt = kept.length;
      }
      return;
    }
    kept.push(section);
  });
  if (insertAt < 0) {
    insertAt = 0;
  }
  const subsections = folded.size > 0 ? folded : entriesFromCommits(commits);
  const cut = [
    { heading: '## Unreleased', body: '' },
    { heading: `## ${version} - ${date}`, body: `\n${writeSubsections(subsections)}\n` },
  ];
  kept.splice(insertAt, 0, ...cut);
  return writeSections(preamble, kept);
}

/** The changelog's text from its preamble and its sections, a section with no body written as its heading alone. */
function writeSections(preamble, sections) {
  const parts = [preamble.trimEnd()];
  sections.forEach((section) => {
    const body = section.body.trim();
    parts.push(body ? `${section.heading}\n\n${body}` : section.heading);
  });
  return `${parts.join('\n\n')}\n`;
}

/** The body of `## <version>`, for the release page. */
function releaseNotes(text, version) {
  const section = splitSections(text).sections.find((candidate) => {
    const read = readVersion(candidate.heading);
    return read && read.version.join('.') === version;
  });
  return section ? `${section.body.trim()}\n` : '';
}

/** Whether a section's body has a `### Highlights` list with something in it. */
function hasHighlights(body) {
  const highlights = readSubsections(body).get('Highlights');
  return Boolean(highlights && highlights.join('').trim());
}

/**
 * What is wrong with a changelog's shape: `## Unreleased` first, then
 * `## X.Y.Z - YYYY-MM-DD` sections, newest first.
 */
function checkChangelog(text) {
  const problems = [];
  const { sections } = splitSections(text);
  if (sections.length === 0 || sections[0].heading !== '## Unreleased') {
    problems.push('The first section must be ## Unreleased.');
  }
  let previous;
  sections.slice(1).forEach((section) => {
    const read = readVersion(section.heading);
    if (!read || !read.date) {
      problems.push(`"${section.heading}" is not "## X.Y.Z - YYYY-MM-DD".`);
      return;
    }
    if (previous && compareVersions(read.version, previous) >= 0) {
      problems.push(`${read.version.join('.')} is not older than the section above it.`);
    }
    previous = read.version;
  });
  return problems;
}

/** A feature release: x.y.0. */
function isFeatureRelease(version) {
  return parseVersion(version)[2] === 0;
}

/** Runs a command of the script, and returns its exit code. */
function main(argv) {
  const file = path.join(process.cwd(), 'CHANGELOG.md');
  const [command, ...args] = argv;
  if (command === 'cut') {
    const [version, date, baseVersion, commitsFile] = args;
    if (!version || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !baseVersion) {
      console.error('Usage: changelog.js cut <version> <YYYY-MM-DD> <baseVersion> [commitsFile]');
      return 2;
    }
    const commits = commitsFile
      ? fs.readFileSync(commitsFile, 'utf8').split('\n').filter(Boolean)
      : [];
    const next = cutChangelog(fs.readFileSync(file, 'utf8'), { version, date, baseVersion, commits });
    const body = releaseNotes(next, version);
    // A feature release is what Home's What's new and Help show, so it is
    // not cut until its Highlights are written.
    if (!hasHighlights(body)) {
      if (isFeatureRelease(version)) {
        console.log(`::error file=CHANGELOG.md::${version} has no Highlights. Write three under "### Highlights" in "## Unreleased".`);
        return 1;
      }
      console.log(`::warning file=CHANGELOG.md::${version} has no Highlights; What's new will show only its heading.`);
    }
    fs.writeFileSync(file, next);
    return 0;
  }
  if (command === 'notes') {
    process.stdout.write(releaseNotes(fs.readFileSync(file, 'utf8'), args[0]));
    return 0;
  }
  if (command === 'check') {
    const problems = checkChangelog(fs.readFileSync(file, 'utf8'));
    problems.forEach((problem) => console.log(`::error file=CHANGELOG.md::${problem}`));
    return problems.length ? 1 : 0;
  }
  console.error('Usage: changelog.js cut|notes|check …');
  return 2;
}

module.exports = {
  checkChangelog,
  cutChangelog,
  hasHighlights,
  isFeatureRelease,
  releaseNotes,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

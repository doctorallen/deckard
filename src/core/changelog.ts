/**
 * Reads the shipped CHANGELOG.md for what Home and Help say is new.
 *
 * A release's `### Highlights` are one to three one-sentence bullets, where
 * only `**bold**` and `` `code` `` are allowed inline: the same text is read
 * on GitHub, in the Extensions view, and in Help. Pure, so the rules can be
 * tested without VS Code.
 */

/** One `## ` section of the changelog: its version, its date once cut, and its Highlights bullets. */
export interface Release {
  /** `1.23.0`, or `Unreleased`. */
  version: string;
  /** `2026-10-02`, when the release has been cut. */
  date?: string;
  highlights: string[];
}

/** Every release in the changelog, newest first, with its Highlights. */
export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | undefined;
  let inHighlights = false;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## (Unreleased|(\d+\.\d+\.\d+)(?: - (\d{4}-\d{2}-\d{2}))?)\s*$/.exec(line);
    if (heading) {
      release = {
        version: heading[2] ?? 'Unreleased',
        ...(heading[3] ? { date: heading[3] } : {}),
        highlights: [],
      };
      releases.push(release);
      inHighlights = false;
      continue;
    }
    if (/^##? /.test(line)) {
      release = undefined;
      inHighlights = false;
      continue;
    }
    if (/^### /.test(line)) {
      inHighlights = release !== undefined && /^### Highlights\s*$/.test(line);
      continue;
    }
    if (!inHighlights || !release) {
      continue;
    }
    const bullet = /^- (.*)$/.exec(line);
    if (bullet) {
      release.highlights.push(bullet[1].trim());
    } else if (/^\s+\S/.test(line) && release.highlights.length > 0) {
      // A wrapped bullet continues on an indented line.
      const last = release.highlights.length - 1;
      release.highlights[last] = `${release.highlights[last]} ${line.trim()}`;
    }
  }
  return releases;
}

/** Compares two x.y.z versions; `Unreleased` is newer than any. */
export function compareVersions(left: string, right: string): number {
  const parts = (version: string) =>
    version === 'Unreleased'
      ? [Infinity, 0, 0]
      : version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parts(left);
  const b = parts(right);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/** Whether going from one version to the other added features: a major or minor step up. */
export function isFeatureUpdate(from: string, to: string): boolean {
  const [fromMajor, fromMinor] = from.split('.').map(Number);
  const [toMajor, toMinor] = to.split('.').map(Number);
  return toMajor > fromMajor || (toMajor === fromMajor && toMinor > fromMinor);
}

/**
 * The cut releases that have Highlights, newest first: those after `after`
 * (when given) up to and including `upTo`.
 */
export function releasesWithHighlights(
  releases: readonly Release[],
  after: string | undefined,
  upTo: string,
): Release[] {
  return releases
    .filter(
      (release) =>
        release.version !== 'Unreleased' &&
        release.highlights.length > 0 &&
        compareVersions(release.version, upTo) <= 0 &&
        (after === undefined || compareVersions(release.version, after) > 0),
    )
    .sort((left, right) => compareVersions(right.version, left.version));
}

/** A Highlight as HTML: escaped, then `**bold**` and `` `code` `` only. */
export function renderHighlightHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** A version as Home says it: major.minor. */
export function shortVersion(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

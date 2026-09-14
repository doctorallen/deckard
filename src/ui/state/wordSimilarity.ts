/**
 * A small BM25-style model of the wording entries share, which adjusts
 * Related Notes scores. Tokenizing is most of its cost, so each entry's terms
 * and the corpus they form are cached per entry and per index.
 */

import { ParsedFile, Section, Task, WorkspaceIndex } from '../../core/types';

interface LexicalModel {
  queryTerms: Set<string>;
  /** Each query term's position, which orders an entry's shared terms. */
  queryOrder: Map<string, number>;
  documentFrequency: Map<string, number>;
  documentCount: number;
  averageLength: number;
}

interface LexicalEvidence {
  weight: number;
  terms: Array<{ term: string; contribution: number }>;
}

type LexicalCorpus = Omit<LexicalModel, 'queryTerms' | 'queryOrder'>;

/**
 * Tokenizing every entry is most of what ranking costs, and it depends only on
 * the index, so it is done once per index rather than per ranking. Entries and
 * indexes are replaced, never changed, when a note is edited, so these caches
 * stay correct and let go of old entries on their own.
 */
const lexicalCorpora = new WeakMap<WorkspaceIndex, LexicalCorpus>();
const lexicalTerms = new WeakMap<Section | Task, string[]>();
const sectionLexicalContents = new WeakMap<Section, string>();

function getSectionTerms(section: Section, fileSections: Section[]): string[] {
  let terms = lexicalTerms.get(section);
  if (!terms) {
    terms = getLexicalTerms(
      section.heading,
      getSectionLexicalContent(section, fileSections),
    );
    lexicalTerms.set(section, terms);
  }
  return terms;
}

function getTaskTerms(task: Task): string[] {
  let terms = lexicalTerms.get(task);
  if (!terms) {
    terms = getLexicalTerms(task.title, task.sourceLineText);
    lexicalTerms.set(task, terms);
  }
  return terms;
}

function getLexicalCorpus(index: WorkspaceIndex): LexicalCorpus {
  const cached = lexicalCorpora.get(index);
  if (cached) {
    return cached;
  }
  const documents = [...index.sections.values()]
    .map((section) =>
      getSectionTerms(section, index.files.get(section.filePath)?.sections ?? []),
    )
    .concat([...index.tasks.values()].map(getTaskTerms));
  const documentFrequency = new Map<string, number>();
  documents.forEach((terms) => {
    new Set(terms).forEach((term) =>
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1),
    );
  });
  const corpus = {
    documentFrequency,
    documentCount: Math.max(1, documents.length),
    averageLength: Math.max(
      1,
      documents.reduce((total, terms) => total + terms.length, 0) /
        Math.max(1, documents.length),
    ),
  };
  lexicalCorpora.set(index, corpus);
  return corpus;
}

export function createLexicalModel(
  index: WorkspaceIndex,
  activeFile: ParsedFile,
): LexicalModel {
  const queryTerms = new Set(
    getLexicalTerms(activeFile.content, activeFile.content),
  );
  return {
    ...getLexicalCorpus(index),
    queryTerms,
    queryOrder: new Map([...queryTerms].map((term, order) => [term, order])),
  };
}

/** Terms by title and text for one index, for results that are not entries. */
const lexicalTermsByText = new WeakMap<WorkspaceIndex, Map<string, string[]>>();

export function getCachedLexicalTerms(
  index: WorkspaceIndex,
  title: string,
  content: string,
): string[] {
  let byText = lexicalTermsByText.get(index);
  if (!byText) {
    byText = new Map();
    lexicalTermsByText.set(index, byText);
  }
  const key = `${title}\u0000${content}`;
  let terms = byText.get(key);
  if (!terms) {
    terms = getLexicalTerms(title, content);
    byText.set(key, terms);
  }
  return terms;
}

/** How often each term occurs, by term list. Cached lists keep theirs. */
const termFrequencies = new WeakMap<string[], Map<string, number>>();

function getTermFrequencies(terms: string[]): Map<string, number> {
  let frequencies = termFrequencies.get(terms);
  if (!frequencies) {
    frequencies = new Map<string, number>();
    for (const term of terms) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    }
    termFrequencies.set(terms, frequencies);
  }
  return frequencies;
}

/**
 * The query terms an entry contains, in query order. It walks whichever set
 * is smaller, since the active note can hold hundreds of distinct terms and
 * an entry a few dozen; query order keeps tied contributions in place.
 */
function getSharedTerms(
  model: LexicalModel,
  frequencies: Map<string, number>,
): string[] {
  if (model.queryTerms.size <= frequencies.size) {
    return [...model.queryTerms].filter((term) => frequencies.has(term));
  }
  return [...frequencies.keys()]
    .filter((term) => model.queryTerms.has(term))
    .sort(
      (left, right) =>
        (model.queryOrder.get(left) ?? 0) - (model.queryOrder.get(right) ?? 0),
    );
}

/** `knownTerms` skips tokenizing an entry whose terms are already cached. */
export function getLexicalWeight(
  model: LexicalModel | undefined,
  title: string,
  content: string,
  knownTerms?: string[],
): LexicalEvidence {
  if (!model || model.queryTerms.size === 0) {
    return { weight: 0, terms: [] };
  }
  const terms = knownTerms ?? getLexicalTerms(title, content);
  const frequencies = getTermFrequencies(terms);
  const lengthFactor =
    1.2 * (1 - 0.75 + 0.75 * (terms.length / model.averageLength));
  const contributions = getSharedTerms(model, frequencies).flatMap((term) => {
    const frequency = frequencies.get(term) ?? 0;
    if (frequency === 0) {
      return [];
    }
    const inverseFrequency = Math.log(
      1 + (model.documentCount - (model.documentFrequency.get(term) ?? 0) + 0.5) /
        ((model.documentFrequency.get(term) ?? 0) + 0.5),
    );
    const contribution =
      inverseFrequency * ((frequency * 2.2) / (frequency + lengthFactor));
    return contribution > 0 ? [{ term, contribution }] : [];
  });
  const rawWeight = contributions.reduce(
    (total, term) => total + term.contribution,
    0,
  );
  return {
    weight: Math.min(0.3, rawWeight / (rawWeight + 1)),
    terms: contributions.sort((left, right) => right.contribution - left.contribution),
  };
}

function getLexicalTerms(title: string, content: string): string[] {
  const ignored = new Set([
    'about',
    'after',
    'before',
    'because',
    'could',
    'should',
    'their',
    'there',
    'these',
    'those',
    'which',
    'would',
    'with',
  ]);
  const clean = `${title}\n${content}`
    .replace(/^---\s*$[\s\S]*?^---\s*$/m, ' ')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
    .replace(/\[\[[^\]]+\]\]|https?:\/\/\S+|[#@][\w/-]+/g, ' ');
  const titleTerms = title
    .replace(/[#@][\w/-]+/g, ' ')
    .toLocaleLowerCase()
    .match(/[a-z][a-z-]{2,}/g) ?? [];
  const bodyTerms = clean.toLocaleLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [];
  return [
    ...titleTerms.filter((word) => !ignored.has(word)),
    ...titleTerms.filter((word) => !ignored.has(word)),
    ...bodyTerms.filter((word) => !ignored.has(word)),
  ];
}

export function getSectionLexicalContent(
  section: Section,
  fileSections: Section[],
): string {
  let content = sectionLexicalContents.get(section);
  if (content === undefined) {
    content = readSectionLexicalContent(section, fileSections);
    sectionLexicalContents.set(section, content);
  }
  return content;
}

/** A section's own text, without the text of the headings nested in it. */
function readSectionLexicalContent(
  section: Section,
  fileSections: Section[],
): string {
  if (section.isInline) {
    return section.rawContent || section.heading;
  }
  const lines = section.rawContent.split(/\r?\n/);
  const excludedChildren = fileSections
    .filter(
      (candidate) =>
        candidate.id !== section.id &&
        candidate.startLine > section.startLine &&
        candidate.endLine <= section.endLine,
    )
    .sort((left, right) => right.startLine - left.startLine);
  excludedChildren.forEach((child) => {
    const start = child.startLine - section.startLine;
    const end = child.endLine - section.startLine + 1;
    lines.splice(start, end - start);
  });
  return lines.join('\n');
}

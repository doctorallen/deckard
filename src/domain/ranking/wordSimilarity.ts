/**
 * A small BM25-style model of the wording entries share, which adjusts
 * Related Notes scores. Tokenizing is most of its cost, so each entry's terms
 * and the corpus they form are cached per entry and per index.
 */

import { findFrontmatterEnd } from '../markdown/frontmatter';
import { ParsedFile, Section, Task, WorkspaceIndex } from '../model';

/**
 * The wording one note is compared by: its terms, in the order they rank,
 * and the corpus statistics BM25 weighs each shared term with.
 */
export interface LexicalModel {
  queryTerms: Set<string>;
  /** Each query term's position, which orders an entry's shared terms. */
  queryOrder: Map<string, number>;
  documentFrequency: Map<string, number>;
  documentCount: number;
  averageLength: number;
}

/** How much an entry's wording shares with a model's, and through which terms. */
export interface LexicalEvidence {
  weight: number;
  /** The BM25 sum before it is capped, which orders wording-only results. */
  rawWeight: number;
  terms: Array<{ term: string; contribution: number }>;
}

/** What a wording model knows of the whole index, before a note is read against it. */
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

/** A section's terms, from its heading and its own text, tokenized once per section. */
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

/** A task's terms, from its title and its line, tokenized once per task. */
function getTaskTerms(task: Task): string[] {
  let terms = lexicalTerms.get(task);
  if (!terms) {
    terms = getLexicalTerms(task.title, task.sourceLineText);
    lexicalTerms.set(task, terms);
  }
  return terms;
}

/**
 * The index's corpus for BM25: how many entries hold each term, how many
 * entries there are, and their average length, each at least one so no
 * score divides by zero. Worked out once per index.
 */
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

/**
 * The wording model for a note being read: every term it holds, in the order
 * it first writes them, over the index's corpus.
 */
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

/**
 * The terms of a title and its text, tokenized once per index for each pair:
 * what ranking asks for a result that is not itself an indexed entry.
 */
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

/** How often each term occurs in a list of terms, counted once per list. */
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
    return [...model.queryTerms].filter(
      (term) => frequencies.has(term) && !isCommonplace(model, term),
    );
  }
  return [...frequencies.keys()]
    .filter((term) => model.queryTerms.has(term) && !isCommonplace(model, term))
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
    return { weight: 0, rawWeight: 0, terms: [] };
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
    rawWeight,
    terms: contributions.sort((left, right) => right.contribution - left.contribution),
  };
}

/** A section's or task's terms, cached as the corpus caches them. */
export function getEntryTerms(index: WorkspaceIndex, entry: Section | Task): string[] {
  return 'heading' in entry
    ? getSectionTerms(entry, index.files.get(entry.filePath)?.sections ?? [])
    : getTaskTerms(entry);
}

/** Every entry holding each term, built once per index. */
const termPostings = new WeakMap<WorkspaceIndex, Map<string, Array<Section | Task>>>();

/** Every entry holding each term, so a model's terms find their candidates. */
export function getTermPostings(index: WorkspaceIndex): Map<string, Array<Section | Task>> {
  let postings = termPostings.get(index);
  if (!postings) {
    postings = new Map();
    const add = (entry: Section | Task, terms: string[]): void => {
      new Set(terms).forEach((term) => {
        const list = postings?.get(term);
        if (list) {
          list.push(entry);
        } else {
          postings?.set(term, [entry]);
        }
      });
    };
    index.sections.forEach((section) => add(section, getEntryTerms(index, section)));
    index.tasks.forEach((task) => add(task, getTaskTerms(task)));
    termPostings.set(index, postings);
  }
  return postings;
}

/**
 * The wording model for a note with nothing else to go on: its terms by
 * tf·idf over the corpus, the top `maxTerms` of them, as Lucene's
 * MoreLikeThis chooses 25. A long journal note would otherwise match
 * everything. Only terms some other note also holds are kept.
 */
export function createMoreLikeThisModel(
  index: WorkspaceIndex,
  activeFile: ParsedFile,
  maxTerms = 25,
): LexicalModel {
  const corpus = getLexicalCorpus(index);
  const postings = getTermPostings(index);
  const frequencies = getTermFrequencies(getLexicalTerms('', activeFile.content));
  const model = { ...corpus, queryTerms: new Set<string>(), queryOrder: new Map<string, number>() };
  const ranked = [...frequencies.entries()]
    .filter(
      ([term]) =>
        !isCommonplace(model, term) &&
        (postings.get(term) ?? []).some((entry) => entry.filePath !== activeFile.filePath),
    )
    .map(([term, frequency]) => {
      const documents = corpus.documentFrequency.get(term) ?? 0;
      const inverse = Math.log(1 + (corpus.documentCount - documents + 0.5) / (documents + 0.5));
      return { term, score: frequency * inverse };
    })
    .sort((left, right) => right.score - left.score || left.term.localeCompare(right.term))
    .slice(0, maxTerms);
  ranked.forEach(({ term }, order) => {
    model.queryTerms.add(term);
    model.queryOrder.set(term, order);
  });
  return model;
}

/**
 * English function words: articles, pronouns, prepositions, conjunctions,
 * auxiliaries, and the adverbs of degree and time. Two entries sharing "and",
 * "the", and "that" are not alike, and the tooltip once named those three as
 * the similar terms. Words under three letters never become terms.
 */
const STOP_WORDS = new Set([
  'about', 'above', 'across', 'after', 'again', 'against', 'all', 'almost',
  'along', 'already', 'also', 'although', 'always', 'among', 'and', 'another',
  'any', 'anyone', 'anything', 'are', 'around', 'because', 'been', 'before',
  'behind', 'being', 'below', 'beside', 'between', 'beyond', 'both', 'but',
  'can', 'cannot', 'could', 'did', 'does', 'doing', 'done', 'down', 'during',
  'each', 'either', 'else', 'ever', 'every', 'everyone', 'everything', 'few',
  'for', 'from', 'get', 'gets', 'got', 'had', 'has', 'have', 'having', 'her',
  'here', 'hers', 'him', 'his', 'how', 'however', 'into', 'its', 'itself',
  'just', 'least', 'less', 'like', 'made', 'make', 'makes', 'many', 'may',
  'might', 'more', 'most', 'much', 'must', 'near', 'neither', 'never', 'nor',
  'not', 'nothing', 'now', 'off', 'often', 'once', 'one', 'ones', 'only',
  'onto', 'other', 'others', 'our', 'ours', 'out', 'over', 'own', 'per',
  'put', 'quite', 'rather', 'same', 'shall', 'she', 'should', 'since', 'some',
  'someone', 'something', 'still', 'such', 'than', 'that', 'the', 'their',
  'theirs', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'though', 'through', 'thus', 'too', 'toward', 'towards', 'under', 'until',
  'upon', 'very', 'via', 'was', 'well', 'were', 'what', 'when', 'where',
  'whether', 'which', 'while', 'who', 'whom', 'whose', 'why', 'will', 'with',
  'within', 'without', 'would', 'yes', 'yet', 'you', 'your', 'yours',
]);

/**
 * A word most entries of a workspace carry says nothing about which two are
 * alike, whatever it is: "standup" in a folder of standups. Judged only once
 * there are enough entries for "most" to mean something.
 */
function isCommonplace(model: LexicalModel, term: string): boolean {
  return (
    model.documentCount >= 10 &&
    (model.documentFrequency.get(term) ?? 0) > model.documentCount / 2
  );
}

/**
 * The terms ranking compares: words of three letters or more, lowercased,
 * without stop words, tags, links, addresses, front matter, or code. The
 * text is read with its title, and the title's words are listed twice more
 * before it, so what an entry is called weighs more than what it says.
 *
 * The note being read is passed whole as both title and text, so front
 * matter is taken off each, and only where a note has it: at its start.
 */
function getLexicalTerms(title: string, content: string): string[] {
  const ignored = STOP_WORDS;
  const heading = withoutFrontmatter(title);
  const clean = `${heading}\n${withoutFrontmatter(content)}`
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
    .replace(/\[\[[^\]]+\]\]|https?:\/\/\S+|[#@][\w/-]+/g, ' ');
  const titleTerms = heading
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

/**
 * The text of a section that counts as its own wording, without the headings
 * nested in it, worked out once per section.
 */
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

/**
 * Text without the front matter it opens with, by the rule every reader of
 * front matter shares; as it is when it opens with none. A `---` further
 * down is a horizontal rule, and what lies between two of them is prose.
 */
function withoutFrontmatter(text: string): string {
  // Most text is an entry, which never opens with a fence; only a note can.
  if (!/^\s*---/.test(text)) {
    return text;
  }
  const lines = text.split(/\r?\n/);
  const end = findFrontmatterEnd(lines);
  return end === undefined ? text : lines.slice(end + 1).join('\n');
}

/**
 * A section's own text, without the text of the headings nested in it.
 *
 * The parser works this out now, so this reads the field. A section parsed
 * before the field existed is measured the old way, by cutting the nested
 * headings back out of the whole subtree.
 */
function readSectionLexicalContent(
  section: Section,
  fileSections: Section[],
): string {
  if (section.isInline) {
    return section.rawContent || section.heading;
  }
  if (section.bodyContent !== undefined) {
    return section.bodyContent;
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

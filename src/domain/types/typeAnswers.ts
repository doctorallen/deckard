/**
 * Answers a question typed in words from the types: "who leads bond
 * trading?", "rates channel", "who is on rates", "what does priya own"
 * (docs/implementation/30-databases.md § Surfaces 3).
 *
 * The words are split into a row phrase and a field phrase:
 *
 * 1. Row: a run of words that is a row's title, slug, tag, or alias, of any
 *    type, read without case, hyphens, or a trailing `s`; failing that, one
 *    word that is part of a name: a title's first word or a part of a slug
 *    (`noor` of `@noor-haddad`).
 * 2. Field: the other words, which must name a field, a reverse, or a word
 *    the field is "also called", on the row's type or within two hops of it.
 *    Question words (`who`, `the`, `is`…) are left out; any other word must
 *    be the field's, or a type's or relation's on the way there.
 * 3. Path: breadth first over relations and their reverses, at most two
 *    hops, from the row to the nearest row with that field. Each of its
 *    values is an answer. A field that says what its row does (`owns`),
 *    asked of a row of the type it names, is read from the other side:
 *    `who owns checkout` is the team whose `owns` lists Checkout.
 *
 * What a question is read against is gathered once per type index, so Find
 * answers as it is typed; a workspace with no types answers nothing.
 */
import { isRowKind, reverseNameOf, toFieldQueryName } from './fieldKinds';
import type { FieldValue, RowField, TypeIndex, TypeRow } from './typeIndex';
import { MAX_PATH_SEGMENTS } from './typeIndex';

/** How many answers a question gets at most. */
export const MAX_ANSWERS = 3;

/** The most relations a path from the named row walks before the field. */
const MAX_HOPS = MAX_PATH_SEGMENTS - 1;

/** The most words a question is read in; a longer text is a search, not a question. */
const MAX_QUESTION_WORDS = 12;

/** The most rows each hop reaches, so a row with hundreds of members cannot slow Find. */
const MAX_ROWS_PER_HOP = 200;

/** Words that ask rather than name: left out of the field phrase. */
const QUESTION_WORDS = new Set([
  'a',
  'about',
  'all',
  'an',
  'and',
  'any',
  'are',
  'at',
  'be',
  'by',
  'current',
  'currently',
  'did',
  'do',
  'does',
  'find',
  'for',
  'from',
  'give',
  'has',
  'have',
  'how',
  'in',
  'is',
  'its',
  'list',
  'me',
  'my',
  'of',
  'on',
  'our',
  'show',
  'tell',
  'that',
  'the',
  'their',
  'this',
  'to',
  'was',
  'were',
  'what',
  'whats',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whos',
  'whose',
  'with',
]);

/** Words that ask for a row's people: the reverse of a person's relation to it. */
const MEMBER_WORDS = new Set(['member', 'people', 'staff', 'person', 'everyone']);

/** `who is on X`, `who's in X`, `who are on X`: a question for X's people. */
const WHO_IS_ON = /^\s*(?:who(?:'s|’s|s)?|who\s+(?:is|are))\s+(?:on|in)\s+/i;

/** One relation a path walks: the field's name, and the row it reaches. */
export interface AnswerHop {
  field: string;
  rowId: string;
}

/** One answer: a value of a field, and the path from the row the question named to it. */
export interface TypeAnswer {
  /** The row the question named. */
  from: TypeRow;
  /** The relations walked from it, none when the field is the row's own. */
  hops: AnswerHop[];
  /** The row whose field holds the value. */
  holder: TypeRow;
  field: RowField;
  value: FieldValue;
  /** How well the words named the row: higher is better. */
  quality: number;
}

/** How well a word that is only part of a row's name names it: below any whole name. */
const PARTIAL_QUALITY = 10;

/** A row the words name, and where in the words its name is. */
export interface RowMatch {
  row: TypeRow;
  /** The first word of its name, and the word after its last. */
  start: number;
  end: number;
  /** How well the words name it: longer names first, then a title over an alias over a slug. */
  quality: number;
  /** Set when one word names it that is only part of its name: `noor` for Noor Haddad. */
  partial?: true;
}

/** A relation whose name says what its row does (`owns`), as the rows it names may be asked about. */
interface VerbField {
  /** The query name of its reverse, which the rows it names hold: `owned-by`. */
  reverse: string;
  /** The type that writes it, whose words a question may use: `which team owns checkout`. */
  typeKey: string;
  /** Its names that read as a verb, each as its words. */
  names: string[][];
}

/** What a question is read against, gathered once per type index. */
interface AnswerVocabulary {
  /** Each row name, as its words joined by spaces, with the rows it names. */
  rowNames: Map<string, Array<{ rowId: string; quality: number }>>;
  /** The most words any row name has. */
  longestName: number;
  /** Each word that is part of a row's name, a title's first word or a part of a slug, with the rows it is part of. */
  partialNames: Map<string, string[]>;
  /** For each type, the relations of other types that name it and say what their row does. */
  verbFields: Map<string, VerbField[]>;
  /** For each type and reverse query name, the words its forward fields are also called. */
  reverseNames: Map<string, Map<string, string[]>>;
  /** Each type's words: its display name and key. */
  typeWords: Map<string, string[]>;
  /** Each row field's names as words, read the first time a question reaches it. */
  fieldNames: WeakMap<RowField, string[][]>;
}

const vocabularies = new WeakMap<TypeIndex, AnswerVocabulary>();

/**
 * The answers to a question, best first: fewest hops, then the row named
 * best, at most {@link MAX_ANSWERS}, each value once. Empty for a workspace
 * with no types, for text that names no row, or for words a field and its
 * path do not account for.
 */
export function answerQuestion(types: TypeIndex, text: string, now: number = Date.now()): TypeAnswer[] {
  if (types.isEmpty || /[=<>:()"[\]]/.test(text)) {
    return [];
  }
  const members = WHO_IS_ON.test(text);
  const words = toWords(members ? text.replace(WHO_IS_ON, ' ') : text);
  if (words.length === 0 || words.length > MAX_QUESTION_WORDS) {
    return [];
  }
  const vocabulary = getVocabulary(types);
  const answers: TypeAnswer[] = [];
  // A row named better that has the field outranks one named worse: "fx
  // team owns" is the FX team's, even when it owns nothing.
  let answeredQuality = -1;
  // Rows named by part of their name that answered: when several did, each
  // gets one answer, so two Noors are both listed.
  const partials = new Set<string>();
  for (const match of matchRows(types, words, vocabulary)) {
    if (match.quality < answeredQuality) {
      break;
    }
    const asked = words
      .filter((_, at) => at < match.start || at >= match.end)
      .filter((word) => !QUESTION_WORDS.has(word.raw))
      .map((word) => word.stem);
    if (asked.length === 0 && !members) {
      continue;
    }
    const found = walkToField({ types, vocabulary, asked, askedSet: new Set(asked), members, now }, match);
    if (found) {
      answers.push(...found);
      answeredQuality = match.quality;
      if (match.partial && found.length > 0) {
        partials.add(match.row.id);
      }
    }
  }
  const seen = new Set<string>();
  const oneEach = partials.size > 1 ? new Set<string>() : undefined;
  return answers
    .map((answer, order) => ({ answer, order }))
    .sort(
      (left, right) =>
        left.answer.hops.length - right.answer.hops.length ||
        right.answer.quality - left.answer.quality ||
        left.order - right.order,
    )
    .map(({ answer }) => answer)
    .filter((answer) => {
      const key = answer.value.rowId ?? answer.value.notePath ?? `${answer.holder.id}\u0000${answer.field.queryName}\u0000${answer.value.text}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      if (oneEach && partials.has(answer.from.id)) {
        if (oneEach.has(answer.from.id)) {
          return false;
        }
        oneEach.add(answer.from.id);
      }
      return true;
    })
    .slice(0, MAX_ANSWERS);
}

/**
 * The rows a text names as a whole, or, when none does, the rows a run of
 * its words names, best first, each once: the longest run, then a title
 * over an alias over a slug, then a row one word is part of the name of.
 * What `deckard_describe_tag` resolves a phrase by.
 */
export function findRowsByPhrase(types: TypeIndex, text: string): RowMatch[] {
  if (types.isEmpty) {
    return [];
  }
  const seen = new Set<string>();
  return matchRows(types, toWords(text), getVocabulary(types)).filter((match) => {
    if (seen.has(match.row.id)) {
      return false;
    }
    seen.add(match.row.id);
    return true;
  });
}

/**
 * The rows runs of the words name, longest runs first, and then the rows
 * one word is part of the name of (`noor` of Noor Haddad). A run of
 * question words alone (`on`, `the`) names nothing, whatever a row is
 * called. A word beside the run that names the row's type is part of it,
 * and names it better: `rates team` is the Rates team.
 */
function matchRows(types: TypeIndex, words: readonly Word[], vocabulary: AnswerVocabulary): RowMatch[] {
  const matches: RowMatch[] = [];
  const longest = Math.min(vocabulary.longestName, words.length);
  for (let length = longest; length >= 1; length -= 1) {
    for (let start = 0; start + length <= words.length; start += 1) {
      const run = words.slice(start, start + length);
      if (run.every((word) => QUESTION_WORDS.has(word.raw))) {
        continue;
      }
      const key = run.map((word) => word.stem).join(' ');
      const whole = vocabulary.rowNames.get(key) ?? [];
      const add = (rowId: string, quality: number, partial: boolean): void => {
        const row = types.row(rowId);
        if (!row) {
          return;
        }
        const typeWords = vocabulary.typeWords.get(row.typeKey) ?? [];
        const before = start > 0 && typeWords.includes(words[start - 1].stem) ? 1 : 0;
        const after = start + length < words.length && typeWords.includes(words[start + length].stem) ? 1 : 0;
        matches.push({
          row,
          start: start - before,
          end: start + length + after,
          quality: quality + (before + after) * 5,
          ...(partial ? { partial: true as const } : {}),
        });
      };
      whole.forEach(({ rowId, quality }) => add(rowId, length * 10 + quality, false));
      if (length === 1) {
        vocabulary.partialNames
          .get(key)
          ?.filter((rowId) => !whole.some((entry) => entry.rowId === rowId))
          .forEach((rowId) => add(rowId, PARTIAL_QUALITY, true));
      }
    }
  }
  const best = new Map<string, RowMatch>();
  matches.forEach((match) => {
    const key = `${match.row.id}\u0000${match.start}\u0000${match.end}`;
    const known = best.get(key);
    if (!known || known.quality < match.quality) {
      best.set(key, match);
    }
  });
  return [...best.values()].sort((left, right) => right.quality - left.quality);
}

/** A row reached by a path, with the relations walked to it. */
interface Reached {
  rowId: string;
  hops: AnswerHop[];
  /** The words of the types and relations on the way, which a question may use. */
  pathWords: Set<string>;
}

/** One question being answered from one named row: the index, what was asked, and when. */
interface Asking {
  types: TypeIndex;
  vocabulary: AnswerVocabulary;
  /** The words left once the row's name and the question words are taken out, stemmed. */
  asked: readonly string[];
  askedSet: ReadonlySet<string>;
  /** Whether the question asks who is on the row (`who is on rates`). */
  members: boolean;
  now: number;
}

/**
 * Walks breadth first from the named row to the nearest rows with a field
 * the asked words name, at most {@link MAX_HOPS} relations away, and
 * answers with that field's values; undefined when no row on the way has
 * the field. A field found empty stops the walk: the nearest answer is
 * that there is none.
 */
function walkToField(asking: Asking, match: RowMatch): TypeAnswer[] | undefined {
  const { types, vocabulary } = asking;
  const visited = new Set([match.row.id]);
  let level: Reached[] = [{ rowId: match.row.id, hops: [], pathWords: new Set(vocabulary.typeWords.get(match.row.typeKey)) }];
  for (let hops = 0; hops <= MAX_HOPS && level.length > 0; hops += 1) {
    const found: TypeAnswer[] = [];
    let matched = false;
    level.forEach((reached) => {
      let fields = findAskedFields(asking, reached);
      const holder = types.row(reached.rowId);
      if (fields.length === 0 && hops === 0) {
        // "who owns checkout": the rows whose `owns` names it, or none.
        const verb = findVerbReverse(asking, reached);
        matched ||= verb !== undefined;
        fields = verb ?? [];
      }
      matched ||= fields.length > 0;
      fields.forEach((field) =>
        field.values.forEach((value) => {
          if (holder) {
            found.push({ from: match.row, hops: reached.hops, holder, field, value, quality: match.quality });
          }
        }),
      );
    });
    if (matched) {
      return found;
    }
    if (hops < MAX_HOPS) {
      level = stepOut(asking, level, visited);
    }
  }
  return undefined;
}

/** The rows one relation further from each row reached, each row once, with the words of the way there. */
function stepOut(asking: Asking, level: readonly Reached[], visited: Set<string>): Reached[] {
  const { types, vocabulary } = asking;
  const next: Reached[] = [];
  const reach = (reached: Reached, field: RowField, words: readonly string[], value: FieldValue): void => {
    const row = value.rowId ? types.row(value.rowId) : undefined;
    if (!row || visited.has(row.id) || next.length >= MAX_ROWS_PER_HOP) {
      return;
    }
    visited.add(row.id);
    next.push({
      rowId: row.id,
      hops: [...reached.hops, { field: field.name, rowId: row.id }],
      pathWords: new Set([...reached.pathWords, ...words, ...(vocabulary.typeWords.get(row.typeKey) ?? [])]),
    });
  };
  level.forEach((reached) => {
    const from = types.row(reached.rowId);
    const reverses = from ? vocabulary.reverseNames.get(from.typeKey) : undefined;
    types
      .fields(reached.rowId)
      .filter((field) => isRowKind(field.kind))
      .forEach((field) => {
        const words = fieldWords(vocabulary, field, reverses).flat();
        field.values.forEach((value) => reach(reached, field, words, value));
      });
  });
  return next;
}

/**
 * The fields of a reached row the asked words name: those whose name, or a
 * word they are also called, is among the words, with every other word the
 * name of a type or relation on the way, or of the value's type. The
 * fields naming the most words win. For a question for the named row's
 * people, the reverses that list people.
 */
function findAskedFields(asking: Asking, reached: Reached): RowField[] {
  const { types, vocabulary, asked, askedSet } = asking;
  const row = types.row(reached.rowId);
  if (!row) {
    return [];
  }
  const reverses = vocabulary.reverseNames.get(row.typeKey);
  const fields = [...types.fields(row.id), ...listComputed(types, row.id, askedSet, asking.now)];
  let best: RowField[] = [];
  let bestSize = 0;
  fields.forEach((field) => {
    fieldWords(vocabulary, field, reverses).forEach((name) => {
      if (name.length === 0 || name.length < bestSize || !name.every((word) => askedSet.has(word))) {
        return;
      }
      if (!isExplained(asking, reached, field, asked.filter((word) => !name.includes(word)))) {
        return;
      }
      if (name.length > bestSize) {
        best = [];
        bestSize = name.length;
      }
      if (!best.includes(field)) {
        best.push(field);
      }
    });
  });
  const forPeople = asking.members || (asked.length > 0 && asked.every((word) => MEMBER_WORDS.has(word)));
  if (best.length > 0 || !forPeople || reached.hops.length > 0) {
    return best;
  }
  // "who is on rates", "rates members": the reverses that list its people.
  return fields.filter(
    (field) =>
      field.source !== 'written' &&
      field.source !== 'computed' &&
      field.values.some((value) => value.via?.rowId.startsWith('@')) &&
      isExplained(asking, reached, field, asked.filter((word) => !MEMBER_WORDS.has(word))),
  );
}

/**
 * For a row no field of its own answers, the reverses of the relations
 * that say what their row does and name its type, when the asked words
 * are one of their names and, at most, their type's words: `who owns
 * checkout` and `which team owns checkout` ask for Checkout's `owned by`.
 * Undefined when no such name is asked; empty when it is and no row's
 * relation names this one, since then nothing owns it.
 */
function findVerbReverse(asking: Asking, reached: Reached): RowField[] | undefined {
  const { types, vocabulary, asked, askedSet } = asking;
  const row = types.row(reached.rowId);
  const verbs = row ? vocabulary.verbFields.get(row.typeKey) : undefined;
  if (!row || !verbs) {
    return undefined;
  }
  let found: RowField[] | undefined;
  verbs.forEach((verb) => {
    const typeWords = vocabulary.typeWords.get(verb.typeKey) ?? [];
    const asks = verb.names.some(
      (name) =>
        name.length > 0 &&
        name.every((word) => askedSet.has(word)) &&
        asked.every((word) => name.includes(word) || typeWords.includes(word) || reached.pathWords.has(word)),
    );
    if (!asks) {
      return;
    }
    found ??= [];
    const reverse = types.fields(row.id).find((field) => field.queryName === verb.reverse && field.values.length > 0);
    if (reverse && !found.includes(reverse)) {
      found.push(reverse);
    }
  });
  return found;
}

/** Whether every word left over names a type or relation on the way, or the type of one of the field's values. */
function isExplained(asking: Asking, reached: Reached, field: RowField, rest: readonly string[]): boolean {
  if (rest.length === 0) {
    return true;
  }
  const { types, vocabulary } = asking;
  const words = new Set(reached.pathWords);
  field.values.forEach((value) => {
    const typeKey = value.rowId ? types.row(value.rowId)?.typeKey : undefined;
    (typeKey ? vocabulary.typeWords.get(typeKey) : undefined)?.forEach((word) => words.add(word));
  });
  return rest.every((word) => words.has(word));
}

/** The computed fields a question can ask for by name, with their words. */
const COMPUTED_ASKED = (['open-tasks', 'last-mentioned', 'mentions'] as const).map((name) => ({
  name,
  words: toWords(name).map((word) => word.stem),
}));

/**
 * The computed fields the asked words name, worked out at `now`; the rest
 * are not worked out, since reading the notes for them is the slow part.
 */
function listComputed(types: TypeIndex, rowId: string, asked: ReadonlySet<string>, now: number): RowField[] {
  return COMPUTED_ASKED.filter(({ words }) => words.every((word) => asked.has(word))).flatMap(
    ({ name }) => types.field(rowId, name, now) ?? [],
  );
}

/**
 * The names a field is asked for by, each as its words, question words
 * left out: its name, the words it is also called, and, for a reverse,
 * the words its forward fields are also called (`responsible for` asks
 * for `owned by` from the other side).
 */
function fieldWords(
  vocabulary: AnswerVocabulary,
  field: RowField,
  reverses: ReadonlyMap<string, string[]> | undefined,
): string[][] {
  const known = vocabulary.fieldNames.get(field);
  if (known) {
    return known;
  }
  const names = [field.name, ...(field.field?.alsoCalled ?? [])];
  if (field.source !== 'written') {
    names.push(...(reverses?.get(field.queryName) ?? []));
  }
  const words = names.map((name) => toWords(name).filter((word) => !QUESTION_WORDS.has(word.raw)).map((word) => word.stem));
  vocabulary.fieldNames.set(field, words);
  return words;
}

/** What questions are read against in one type index: its rows' names, reverses' other names, and types' names. */
function getVocabulary(types: TypeIndex): AnswerVocabulary {
  let vocabulary = vocabularies.get(types);
  if (!vocabulary) {
    vocabulary = { ...gatherRowNames(types), ...gatherTypeWords(types), fieldNames: new WeakMap() };
    vocabularies.set(types, vocabulary);
  }
  return vocabulary;
}

/** Each row's names, whole and in part, for matching runs of a question's words. */
function gatherRowNames(types: TypeIndex): Pick<AnswerVocabulary, 'rowNames' | 'longestName' | 'partialNames'> {
  const rowNames = new Map<string, Array<{ rowId: string; quality: number }>>();
  const partialNames = new Map<string, string[]>();
  let longestName = 0;
  const add = (name: string | undefined, rowId: string, quality: number): void => {
    const words = name ? toWords(name).map((word) => word.stem) : [];
    if (words.length === 0) {
      return;
    }
    const key = words.join(' ');
    const rows = rowNames.get(key) ?? [];
    const known = rows.find((entry) => entry.rowId === rowId);
    if (known) {
      known.quality = Math.max(known.quality, quality);
    } else {
      rows.push({ rowId, quality });
      rowNames.set(key, rows);
    }
    longestName = Math.max(longestName, words.length);
  };
  const addPartial = (words: readonly Word[], rowId: string): void => {
    words.forEach(({ raw, stem }) => {
      const rows = partialNames.get(stem) ?? [];
      if (QUESTION_WORDS.has(raw) || rows.includes(rowId)) {
        return;
      }
      rows.push(rowId);
      partialNames.set(stem, rows);
    });
  };
  types.rows().forEach((row) => {
    add(row.title, row.id, 3);
    const titleWords = toWords(row.title);
    if (titleWords.length > 1) {
      addPartial(titleWords.slice(0, 1), row.id);
    }
    row.aliases.forEach((alias) => add(alias, row.id, 2));
    [row.id, ...row.tagKeys].forEach((key) => {
      if (key.startsWith('file:')) {
        return;
      }
      const slug = key.slice(key.lastIndexOf('/') + 1);
      add(key, row.id, 1);
      add(slug, row.id, 1);
      const slugWords = toWords(slug);
      if (slugWords.length > 1) {
        addPartial(slugWords, row.id);
      }
    });
  });
  return { rowNames, longestName, partialNames };
}

/** Each type's words, and the words its relations are asked by from the rows they name. */
function gatherTypeWords(types: TypeIndex): Pick<AnswerVocabulary, 'reverseNames' | 'verbFields' | 'typeWords'> {
  const reverseNames = new Map<string, Map<string, string[]>>();
  const verbFields = new Map<string, VerbField[]>();
  const typeWords = new Map<string, string[]>();
  types.registry.types.forEach((type) => {
    typeWords.set(type.key, [...new Set([...toWords(type.name), ...toWords(type.key)].map((word) => word.stem))]);
    type.fields.forEach((field) => {
      if (!isRowKind(field.kind)) {
        return;
      }
      const targets = [
        ...(field.kind.targets ?? []),
        ...(field.kind.name === 'person' || field.kind.people
          ? types.registry.tagTypes.filter((target) => target.rows?.kind === 'tags' && target.rows.prefix === '@').map((target) => target.key)
          : []),
      ];
      const reverse = toFieldQueryName(reverseNameOf(field));
      const verbs = [field.name, ...field.alsoCalled].filter(isVerbShaped).map((name) => toWords(name).map((word) => word.stem));
      targets.forEach((target) => {
        if (field.alsoCalled.length > 0) {
          const byName = reverseNames.get(target) ?? new Map<string, string[]>();
          byName.set(reverse, [...(byName.get(reverse) ?? []), ...field.alsoCalled]);
          reverseNames.set(target, byName);
        }
        if (verbs.length > 0) {
          verbFields.set(target, [...(verbFields.get(target) ?? []), { reverse, typeKey: type.key, names: verbs }]);
        }
      });
    });
  });
  return { reverseNames, verbFields, typeWords };
}

/**
 * Whether a field's name says what its row does, as a verb whose subject
 * is the row: `owns`, `uses`, `depends on`, but not `lead` or `status`.
 * Only such a field is read from the other side when the row a question
 * names is one of its values: a team's `lead` is who leads the team, so
 * `who leads dana` is not the team Dana leads.
 */
function isVerbShaped(name: string): boolean {
  const [first] = toWords(name);
  return first !== undefined && first.raw.length > 3 && /[^siu]s$/.test(first.raw);
}

/** A word of a question or a name: as written, lowercased, and stemmed for comparing. */
interface Word {
  raw: string;
  stem: string;
}

/**
 * Text as words: lowercased, a possessive `'s` dropped, split at anything
 * that is not a letter or digit (so hyphens, slashes, `#`, and `@` part
 * words), each compared without a trailing `s` (`owns` is `own`, `rates`
 * is `rate`).
 */
function toWords(text: string): Word[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((raw) => ({ raw, stem: raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw }));
}

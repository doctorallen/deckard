/**
 * The host's side of This page and the Tour (plan 48): a tree of elements,
 * which the Help page builds with the DOM. Text stays text, so nothing here
 * escapes; the page builds only the tags and attributes it allows.
 */
import type { HelpViewElement, HelpViewNode, HelpViewTag } from '../../../protocol/help';

/** A child as written: a node, a list of them, or nothing, for a part left out. */
export type HelpViewChild = HelpViewNode | readonly HelpViewChild[] | false | null | undefined;

/** Attributes as written: `true` sets one empty, `false` and `undefined` leave it out. */
export type HelpViewAttrs = Readonly<Record<string, string | number | boolean | undefined>>;

/** Every child, lists flattened, with nothing and empty text left out. */
function flatten(children: readonly HelpViewChild[]): HelpViewNode[] {
  return children.flatMap((child): HelpViewNode[] => {
    if (child === false || child === null || child === undefined || child === '') {
      return [];
    }
    if (Array.isArray(child)) {
      return flatten(child);
    }
    return [child as HelpViewNode];
  });
}

/** The attributes kept, each as text. */
function readAttrs(attrs: HelpViewAttrs): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === undefined) {
      continue;
    }
    kept[name] = value === true ? '' : String(value);
  }
  return kept;
}

/** Some children as nodes: lists flattened, and nothing and empty text left out. */
export function viewNodes(...children: HelpViewChild[]): HelpViewNode[] {
  return flatten(children);
}

/** An element, with its attributes and children. */
export function h(tag: HelpViewTag, attrs?: HelpViewAttrs | null, ...children: HelpViewChild[]): HelpViewElement {
  const kept = attrs ? readAttrs(attrs) : {};
  const nodes = flatten(children);
  return {
    tag,
    ...(Object.keys(kept).length ? { attrs: kept } : {}),
    ...(nodes.length ? { children: nodes } : {}),
  };
}

/** Text with its `**bold**` words made bold, and its `` `code` `` code when asked. */
export function inlineText(text: string, { code = false } = {}): HelpViewNode[] {
  const pattern = code ? /\*\*([^*]+)\*\*|`([^`]+)`/g : /\*\*([^*]+)\*\*/g;
  const nodes: HelpViewNode[] = [];
  let from = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    nodes.push(text.slice(from, at));
    nodes.push(match[1] === undefined ? h('code', null, match[2]) : h('b', null, match[1]));
    from = at + match[0].length;
  }
  nodes.push(text.slice(from));
  return nodes.filter((node) => node !== '');
}

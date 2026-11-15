/**
 * Builds This page and the Tour from the tree the host sends (plan 48),
 * with the DOM and never HTML. Only the tags and attributes below are built:
 * no event handler, link, source, or style attribute, so nothing in a
 * message can run script or load anything. Text is set as text. A guide
 * section's own HTML, which the host rendered from the guide the VSIX ships,
 * goes to the one place the page sets HTML, as the guide's does.
 */
import type { HelpViewElement, HelpViewNode, HelpViewTag } from '../../ui/protocol/help';

/** Every tag the page builds, and nothing else. */
const TAGS: Readonly<Record<HelpViewTag, true>> = {
  aside: true,
  b: true,
  button: true,
  code: true,
  details: true,
  div: true,
  h1: true,
  h2: true,
  h3: true,
  input: true,
  kbd: true,
  label: true,
  li: true,
  option: true,
  p: true,
  section: true,
  select: true,
  span: true,
  summary: true,
  ul: true,
};

/** The attributes the page sets besides `aria-*` and `data-*`. */
const ATTRIBUTES = new Set(['checked', 'class', 'disabled', 'for', 'hidden', 'id', 'open', 'role', 'selected', 'tabindex', 'title', 'type', 'value']);

/** Whether the page builds a tag. */
function isViewTag(tag: unknown): tag is HelpViewTag {
  return typeof tag === 'string' && Object.hasOwn(TAGS, tag);
}

/** Whether the page sets an attribute. */
export function isViewAttribute(name: string): boolean {
  return ATTRIBUTES.has(name) || /^(aria|data)-[a-z][a-z-]*$/.test(name);
}

/** Sets a guide section's rendered HTML as an element's content. */
export type SetGuideHtml = (into: HTMLElement, html: string) => void;

/** One element, its attributes allowed, its children built, or its guide section set. */
function buildElement(node: HelpViewElement, doc: Document, setGuideHtml: SetGuideHtml): Node {
  if (!isViewTag(node.tag)) {
    return doc.createTextNode('');
  }
  const element = doc.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if (isViewAttribute(name)) {
      element.setAttribute(name, String(value));
    }
  }
  if (typeof node.flex === 'number') {
    element.style.flex = String(node.flex);
  }
  if (typeof node.guideHtml === 'string') {
    setGuideHtml(element, node.guideHtml);
  } else if (Array.isArray(node.children)) {
    element.append(...buildView(node.children, doc, setGuideHtml));
  }
  return element;
}

/** The nodes the host described, as DOM nodes to put in a panel. */
export function buildView(nodes: readonly HelpViewNode[], doc: Document, setGuideHtml: SetGuideHtml): Node[] {
  return nodes.map((node) => {
    if (typeof node === 'string') {
      return doc.createTextNode(node);
    }
    return node && typeof node === 'object' ? buildElement(node, doc, setGuideHtml) : doc.createTextNode('');
  });
}

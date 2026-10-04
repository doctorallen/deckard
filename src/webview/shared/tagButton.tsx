/**
 * A tag as a control that opens its overview, and a title with the tags
 * written in it drawn as such controls where they appear.
 */
import type { ComponentChild } from 'preact';

import type { TagReference } from '../../ui/protocol/shared';
import { TagLabel } from './tagLabel';
import { createTagLabelPattern } from './tagPattern';

/**
 * A tag that opens its overview: its namespace dimmed before its value,
 * named for a screen reader as what it opens, and tipped with its whole
 * label when it is cut short. `className` follows `tag-open`, after a space
 * that is there with or without it, as the template wrote it.
 */
export function TagButton({ tag, className }: { readonly tag: TagReference; readonly className?: string }) {
  return (
    <button
      class={`tag-open ${className || ''}`}
      data-action="open-tag"
      data-tag-key={tag.key}
      data-tip-overflow={tag.label}
      aria-label={`Open ${tag.label} overview`}
    >
      <TagLabel label={tag.label} />
    </button>
  );
}

/** A pattern that finds any of the tags' labels as whole tags, or none when no tag has one. */
function labelPattern(tags: readonly TagReference[]): RegExp | undefined {
  return createTagLabelPattern(tags.map((tag) => tag.label));
}

/**
 * Text with each tag written in it drawn as the control that opens it, in
 * its place, as `inline-tag` buttons. With `appendMissing`, a tag the text
 * does not write comes after it, so every tag is still a control. Returns
 * undefined when the text writes none of the tags and nothing is appended.
 */
export function withTagButtons(
  text: string,
  tags: readonly TagReference[],
  appendMissing: boolean,
): ComponentChild[] | undefined {
  const pattern = labelPattern(tags);
  if (!pattern) {
    return undefined;
  }
  const drawn: ComponentChild[] = [];
  const matched = new Set<string>();
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    const tag = tags.find((candidate) => candidate.label === match[0]);
    if (at > offset) {
      drawn.push(text.slice(offset, at));
    }
    if (tag) {
      matched.add(tag.key);
      drawn.push(<TagButton tag={tag} className="inline-tag" />);
    } else {
      drawn.push(match[0]);
    }
    offset = at + match[0].length;
  }
  const trailing = appendMissing ? tags.filter((tag) => !matched.has(tag.key)) : [];
  if (!matched.size && !trailing.length) {
    return undefined;
  }
  if (offset < text.length) {
    drawn.push(text.slice(offset));
  }
  return [...drawn, ...trailing.map((tag) => <TagButton tag={tag} className="inline-tag" />)];
}

/**
 * A plain title, such as a card's heading, with the tags written in it as
 * the controls that open them, and, unless `appendMissing` is false, any
 * other tag after it.
 */
export function TitleWithTags({ title, tags, appendMissing }: {
  readonly title: string;
  readonly tags: readonly TagReference[];
  readonly appendMissing?: boolean;
}) {
  return <>{withTagButtons(title, tags, appendMissing !== false) ?? title}</>;
}

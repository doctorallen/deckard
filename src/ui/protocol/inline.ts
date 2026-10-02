/**
 * Markdown as the pages receive it: a title's words as an inline token
 * tree, and an excerpt's as blocks of them, which a page draws as elements
 * and text nodes, never as HTML (docs/architecture/webviews.md, "What
 * ships"). The trees are the domain model's; the pages take their types
 * from here, since they import the protocol and not the domain.
 */
export type { InlineToken } from '../../domain/model/inline';
export type { BlockToken } from '../../domain/model/blocks';

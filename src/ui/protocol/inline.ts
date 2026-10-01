/**
 * Inline Markdown as the pages receive it: a title's or an excerpt's words
 * as a token tree, which a page draws as elements and text nodes, never as
 * HTML (docs/architecture/webviews.md, "What ships"). The tree is the
 * domain model's; the pages take its types from here, since they import
 * the protocol and not the domain.
 */
export type {
  BreakToken,
  CodeToken,
  EmphasisToken,
  InlineToken,
  LinkToken,
  TextToken,
  WikiLinkToken,
} from '../../domain/model/inline';

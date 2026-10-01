import MarkdownIt = require('markdown-it');
import sanitizeHtml = require('sanitize-html');

import { guideSlug } from '../../guide';
import { rewriteGuideHtml } from './guideLinks';

const markdown = new MarkdownIt({ html: true, linkify: false });

/**
 * A guide page as the Help panel shows it: headings carry the anchors GitHub
 * gives them, links between pages stay in the panel, and screenshots load
 * from GitHub, since the VSIX leaves them out to stay small.
 */
export function renderGuidePage(source: string): string {
  const tokens = markdown.parse(source, {});
  tokens.forEach((token, at) => {
    if (token.type !== 'heading_open') {
      return;
    }
    const inline = tokens[at + 1];
    token.attrSet('id', guideSlug(inline?.content ?? ''));
  });
  return sanitizeGuideHtml(rewriteGuideHtml(markdown.renderer.render(tokens, markdown.options, {})));
}

function sanitizeGuideHtml(html: string): string {
  const headingAttributes = ['id'];
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'hr', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'b', 'i', 'kbd', 'sup', 'sub',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'data-guide-page', 'data-guide-anchor', 'data-action'],
      img: ['src', 'alt', 'width', 'height'],
      h1: headingAttributes,
      h2: headingAttributes,
      h3: headingAttributes,
      h4: headingAttributes,
      h5: headingAttributes,
      h6: headingAttributes,
      td: ['align'],
      th: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['https'] },
    allowProtocolRelative: false,
  });
}

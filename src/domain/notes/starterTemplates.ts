/**
 * The templates Deckard offers to write into an empty templates folder, so
 * New Note from Template has something to start from: a meeting, a 1:1,
 * and a decision record, each using the placeholders every template can.
 */

/** One starter template: its file name and what it holds. */
export interface StarterTemplate {
  fileName: string;
  content: string;
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    fileName: 'Meeting.md',
    content: [
      '# {title} #meeting',
      '',
      '{date} · {ask:Who was there?}',
      '',
      '## Agenda',
      '',
      '## Notes',
      '',
      '## Decisions',
      '',
      '## Action items',
      '',
    ].join('\n'),
  },
  {
    fileName: 'One-on-one.md',
    content: [
      '# {title} #meeting/1-1',
      '',
      '{date} with @{ask:Who is the 1:1 with?}',
      '',
      '## Their topics',
      '',
      '## My topics',
      '',
      '## Feedback',
      '',
      '## Follow-ups',
      '',
    ].join('\n'),
  },
  {
    fileName: 'Decision record.md',
    content: [
      '# {title} #decision',
      '',
      'Date: {date}',
      'Status: {ask:Status, such as proposed or accepted?}',
      '',
      '## Context',
      '',
      '## Options',
      '',
      '## Decision',
      '',
      '## Consequences',
      '',
    ].join('\n'),
  },
];

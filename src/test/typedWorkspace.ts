/**
 * A small who-owns-what knowledge base with types, for the query tests:
 * people, teams, and areas as namespace types, incidents as a note type.
 */
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { ParsedFile, WorkspaceIndex } from '../domain/model';

/** The moment the notes were written, and the tests ask at. */
export const now = new Date(2026, 9, 8, 12).getTime();

/** A note parsed as the scanner parses it: a type note when it is in `Types/`. */
function parse(filePath: string, content: string): ParsedFile {
  return parseMarkdown(filePath, content, { createdAt: now, updatedAt: now }, { typeNote: filePath.startsWith('Types/') });
}

/** The index of these notes. */
export function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(new Map(Object.entries(notes).map(([filePath, content]) => [filePath, parse(filePath, content)])));
}

const lines = (...text: string[]): string => text.join('\n');

/** People, teams, areas, and incidents: a small who-owns-what knowledge base. */
export function typedWorkspace(): WorkspaceIndex {
  return indexOf({
    'Types/Person.md': lines(
      '---',
      'deckard-type: person',
      'rows: "@*"',
      '---',
      '# Person',
      '',
      '| Field  | Kind     | Reverse |',
      '| ------ | -------- | ------- |',
      '| team   | Team     | members |',
      '| email  | Email    |         |',
      '| start  | Date     |         |',
      '| remote | Checkbox |         |',
    ),
    'Types/Team.md': lines(
      '---',
      'deckard-type: team',
      'rows: "#team/*"',
      '---',
      '# Team',
      '',
      '| Field     | Kind                         | Reverse  |',
      '| --------- | ---------------------------- | -------- |',
      '| lead      | Person                       | lead of  |',
      '| owns      | Area, many                   | owned by |',
      '| tier      | Select: gold, silver, bronze |          |',
      '| headcount | Number                       |          |',
      '| on-call   | Person                       |          |',
      '| status    | Text                         |          |',
    ),
    'Types/Area.md': lines('---', 'deckard-type: area', 'rows: "#area/*"', '---', '# Area', '', '| Field | Kind |', '| ----- | ---- |', '| system | Text |'),
    'Types/Incident.md': lines(
      '---',
      'deckard-type: incident',
      'rows: notes',
      '---',
      '# Incident',
      '',
      '| Field    | Kind               |',
      '| -------- | ------------------ |',
      '| owner    | Person             |',
      '| team     | Team               |',
      '| severity | Select: sev1, sev2 |',
    ),
    'Teams/Rates.md': lines(
      '---',
      'describes: "#team/rates"',
      'lead: "@dana"',
      'owns: [bond trading, "#area/fx"]',
      'tier: Gold',
      'headcount: "1,200"',
      'on-call: Priya Natarajan',
      'status: active',
      '---',
      '# Rates',
      '- [ ] Hire a quant 📅 2020-01-01',
    ),
    'Teams/Credit.md': lines('---', 'describes: "#team/credit"', 'lead: omar', 'tier: silver', 'headcount: 8', '---', '# Credit'),
    'People/Dana Whitfield.md': lines(
      '---',
      'describes: "@dana"',
      'team: rates',
      'email: dana@example.com',
      'start: 2026-03-01',
      'remote: yes',
      '---',
      '# Dana Whitfield',
    ),
    'People/Omar Haddad.md': lines('---', 'describes: "#person/omar"', 'team: "#team/credit"', '---', '# Omar Haddad'),
    'People/Priya Natarajan.md': lines('---', 'describes: "@priya"', '---', '# Priya Natarajan'),
    'notes/areas.md': lines('# Areas #area/bond-trading', 'Who owns what.', '', '# FX #area/fx', 'Currencies.'),
    'notes/standup.md': lines('# Standup #team/rates', '- [ ] Fix pricing'),
    'Incidents/RFQ outage.md': lines('---', 'type: incident', 'owner: dana', 'team: Rates', 'severity: SEV1', '---', '# RFQ outage', 'Quotes stalled.'),
    'Incidents/Feed lag.md': lines('---', 'type: incident', 'team: credit', 'severity: sev2', '---', '# Feed lag'),
    'notes/plain.md': lines('# Plain', 'Nothing typed here.'),
  });
}

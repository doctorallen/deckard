import { register as assistant } from '../ui/commands/assistant/register';
import { register as dailyNotes } from '../ui/commands/dailyNotes/register';
import { register as find } from '../ui/commands/find/register';
import { register as hubs } from '../ui/commands/hubs/register';
import { register as links } from '../ui/commands/links/register';
import { register as notes } from '../ui/commands/notes/register';
import { register as noteTemplates } from '../ui/commands/noteTemplates/register';
import { register as outline } from '../ui/commands/outline/register';
import { register as pages } from '../ui/commands/pages/register';
import { register as parkingAndExclusion } from '../ui/commands/parkingAndExclusion/register';
import { register as pins } from '../ui/commands/pins/register';
import { register as preferences } from '../ui/commands/preferences/register';
import { register as reviews } from '../ui/commands/reviews/register';
import { register as search } from '../ui/commands/search/register';
import { register as setup } from '../ui/commands/setup/register';
import { register as tagEditing } from '../ui/commands/tagEditing/register';
import { register as taskEditing } from '../ui/commands/taskEditing/register';
import { register as tasksView } from '../ui/commands/tasksView/register';
import { register as toggles } from '../ui/commands/toggles/register';
import { register as types } from '../ui/commands/types/register';
import { register as undo } from '../ui/commands/undo/register';
import type { NamedFeature } from './feature';

/**
 * Every feature, in the order activation runs them.
 *
 * The order is by where each feature's first command was registered in
 * activate() before Phase 5, when every command was registered inline. Within
 * one synchronous activation VS Code cannot tell the order apart; the rule
 * is kept so the list has one order, not one chosen by taste.
 */
export const features: readonly NamedFeature[] = [
  { name: 'setup and diagnostics', register: setup },
  { name: 'the Tasks view', register: tasksView },
  { name: 'the Outline and sections', register: outline },
  { name: 'settings toggles', register: toggles },
  { name: 'preference backups', register: preferences },
  { name: 'pages', register: pages },
  { name: 'Note Actions', register: notes },
  { name: 'daily notes', register: dailyNotes },
  { name: 'reviews', register: reviews },
  { name: 'task editing', register: taskEditing },
  { name: 'note templates', register: noteTemplates },
  { name: 'pins', register: pins },
  { name: 'parking and exclusion', register: parkingAndExclusion },
  { name: 'assistant and MCP', register: assistant },
  { name: 'links', register: links },
  { name: 'search pages', register: search },
  { name: 'Find', register: find },
  { name: 'tag editing', register: tagEditing },
  { name: 'Undo Last Change', register: undo },
  { name: 'the Hubs view', register: hubs },
  { name: 'types', register: types },
];

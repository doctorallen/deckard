import { register as assistant } from '../ui/commands/assistant/register';
import { register as captureAndTemplates } from '../ui/commands/captureAndTemplates/register';
import { register as notes } from '../ui/commands/notes/register';
import { register as outline } from '../ui/commands/outline/register';
import { register as pages } from '../ui/commands/pages/register';
import { register as parkingAndExclusion } from '../ui/commands/parkingAndExclusion/register';
import { register as search } from '../ui/commands/search/register';
import { register as setup } from '../ui/commands/setup/register';
import { register as tagsAndLinks } from '../ui/commands/tagsAndLinks/register';
import { register as tasks } from '../ui/commands/tasks/register';
import { register as toggles } from '../ui/commands/toggles/register';
import type { NamedFeature } from './feature';

/**
 * Every feature, in the order activation runs them: the order in which each
 * one's first command used to be registered.
 */
export const features: readonly NamedFeature[] = [
  { name: 'preferences and setup', register: setup },
  { name: 'tasks and the Tasks view', register: tasks },
  { name: 'the Outline and sections', register: outline },
  { name: 'settings toggles', register: toggles },
  { name: 'pages', register: pages },
  { name: 'notes and daily notes', register: notes },
  { name: 'capture and templates', register: captureAndTemplates },
  { name: 'parking and exclusion', register: parkingAndExclusion },
  { name: 'assistant and MCP', register: assistant },
  { name: 'tags and links', register: tagsAndLinks },
  { name: 'search and Find', register: search },
];

import { OutlineNode } from '../state/outlineState';

/**
 * The tag a command was run with, or undefined when it was given none.
 *
 * Serialized command URIs arrive as arrays, while the command palette
 * supplies no argument, so both are read here.
 */
export function getCommandTagArgument(value: unknown): string | undefined {
  const argument = Array.isArray(value) ? value[0] : value;
  return typeof argument === 'string' ? argument : undefined;
}

/**
 * Validates the tree argument because these commands are also reachable from
 * keybindings and other extensions, which can pass anything.
 */
export function asOutlineNode(value: unknown): OutlineNode | undefined {
  return typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'line' in value &&
    'tags' in value
    ? (value as OutlineNode)
    : undefined;
}

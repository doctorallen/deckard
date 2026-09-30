/**
 * A shim that keeps `import … from './repeatRuleHealth'` compiling while the
 * refactor moves importers to their new homes. Phase 7 deletes it.
 *
 * - The diagnostics and quick fixes are in `src/ui/providers/repeatRuleHealth.ts`.
 * - Finding and wording the problems is in `src/domain/markdown/repeatRuleProblems.ts`.
 */
export * from '../providers/repeatRuleHealth';
export {
  describeRepeatRuleProblem,
  findRepeatRuleProblems,
} from '../../domain/markdown/repeatRuleProblems';
export type { RepeatRuleProblem } from '../../domain/markdown/repeatRuleProblems';

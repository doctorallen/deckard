/**
 * Where the hosts not yet on WebviewHost import a panel's redraw priority
 * from. It moved to `host/panelPriority.ts`; step 2.10 of the Phase 6 plan
 * deletes this once every host imports it from there.
 */
export { panelPriority, viewPriority } from './host/panelPriority';

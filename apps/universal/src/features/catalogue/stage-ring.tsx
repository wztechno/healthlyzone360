/**
 * The module TypeScript, Node and any non-Metro tool resolve for `./stage-ring`.
 *
 * Metro picks `stage-ring.web.tsx` on the web and `stage-ring.native.tsx` on a phone; this file
 * exists only so a plain import has something to typecheck against, and points at the web half as
 * `range-slider.tsx` does.
 */
export { StageRing } from './stage-ring.web.tsx';
export type { StageRingProps } from './stage-ring-shared.ts';

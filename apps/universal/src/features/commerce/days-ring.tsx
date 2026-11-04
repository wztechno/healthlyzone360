/**
 * The module TypeScript, Node and any non-Metro tool resolve for `./days-ring`.
 *
 * Metro picks `days-ring.web.tsx` on the web and `days-ring.native.tsx` on a phone; this file exists
 * only so a plain import has something to typecheck against, as `catalogue/stage-ring.tsx` does.
 */
export { DaysRing } from './days-ring.web.tsx';
export type { DaysRingProps } from './days-ring-shared.ts';

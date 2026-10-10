/**
 * The module TypeScript, Node and any non-Metro tool resolve for `./section-grid` — the same
 * technique as `primitives/grid.tsx`: Metro picks `section-grid.web.tsx` or `.native.tsx`, and this
 * points at the web half so a plain import has something to typecheck against.
 */
export { SectionGrid } from './section-grid.web.tsx';
export type { SectionGridProps } from './section-grid-shared.ts';

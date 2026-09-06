/**
 * The module TypeScript, Node and any non-Metro tool resolve for `./grid`.
 *
 * Same technique, and the same reason, as `date-field.tsx` and `slider-field.tsx`: Metro's platform
 * extensions pick `grid.native.tsx` on iOS and Android and `grid.web.tsx` on the web, and the two
 * are genuinely different mechanisms — a CSS grid against a wrapping flex row. This file exists so
 * a plain `./grid` import has something to typecheck against, and it points at the web half because
 * that is the one a browser-based tool would run.
 *
 * Everything shared lives in `grid-shared.ts` and is exported from there, never through this file.
 */
export { CardGrid, FormGrid, Grid } from './grid.web.tsx';
export type { GridColumnCount, GridProps, GridSpanProps } from './grid-shared.ts';

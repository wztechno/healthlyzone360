/**
 * The module TypeScript, Node and any non-Metro tool resolve for `./slider-field`.
 *
 * Same technique, and the same reason, as `date-field.tsx` and `field-label.tsx`: Metro's platform
 * extensions pick `slider-field.native.tsx` on iOS and Android and `slider-field.web.tsx` on the
 * web, and this file exists only so a plain `./slider-field` import has something to typecheck
 * against. It points at the web half because that is the one a browser-based tool would run.
 *
 * Anything shared lives in `slider-field-shared.ts` and is exported from there, never through this
 * file — a name re-exported here that only one platform half provides would break at runtime on
 * the other.
 */
export { SliderField } from './slider-field.web.tsx';
export type { SliderFieldProps, SliderDirection } from './slider-field-shared.ts';

/**
 * The module TypeScript, Node and any non-Metro tool resolve for `./anchored-layer`.
 *
 * Same technique as `forms/slider-field.tsx`: Metro picks `anchored-layer.native.tsx` on iOS and
 * Android and `anchored-layer.web.tsx` on the web, and this file exists only so a plain
 * `./anchored-layer` import has something to typecheck against. It points at the web half because
 * that is the one a browser-based tool would run.
 */
export { AnchoredLayer, PANEL_IS_LIFTED } from './anchored-layer.web.tsx';
export type { AnchoredLayerProps } from './anchored-layer-shared.ts';

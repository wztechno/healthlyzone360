/**
 * The module TypeScript, Node and any non-Metro tool resolve for `./range-slider`.
 *
 * The same split as the design system's `slider-field.tsx`: Metro picks `range-slider.web.tsx` on
 * the web and `range-slider.native.tsx` on a phone, and this file exists only so a plain import has
 * something to typecheck against. It points at the web half because that is the one a browser-based
 * tool would run. Shared names live in `range-slider-shared.ts`.
 */
export { RangeSlider } from './range-slider.web.tsx';
export type { RangeEnds, RangeSliderProps } from './range-slider-shared.ts';

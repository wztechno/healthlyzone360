/**
 * The module TypeScript, Node and any non-Metro tool resolve for `./select`.
 *
 * Same technique, and the same reason, as `slider-field.tsx`, `date-field.tsx` and
 * `field-label.tsx`: Metro's platform extensions pick `select.native.tsx` on iOS and Android and
 * `select.web.tsx` on the web, and this file exists only so a plain `./select` import has something
 * to typecheck against. It points at the web half because that is the one a browser-based tool
 * would run.
 *
 * The two halves render differently on purpose — an anchored listbox on the web, a modal radio
 * group on a phone — and share their props, their filter and their test identities through
 * `select-shared.ts`. Anything shared is exported from there, never through this file: a name
 * re-exported here that only one half provides would break at runtime on the other.
 */
export { Select } from './select.web.tsx';
export type { SelectOption, SelectProps } from './select-shared.ts';

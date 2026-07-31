/**
 * The module TypeScript, Node and any non-Metro tool resolve for `./field-label`.
 *
 * Same technique, and the same reason, as `date-field.tsx`: Metro's platform extensions pick
 * `field-label.native.tsx` on iOS and Android and `field-label.web.tsx` on the web, and this file
 * exists only so a plain `./field-label` import has something to typecheck against. It points at
 * the web half because that is the one a browser-based tool would run.
 */
export { FieldLabel } from './field-label.web.tsx';
export type { FieldLabelProps } from './field-label-shared.ts';

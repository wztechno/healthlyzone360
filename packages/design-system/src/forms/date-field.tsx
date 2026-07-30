/**
 * The module TypeScript, Node and any non-Metro tool resolve for `./date-field`.
 *
 * Metro's platform extensions pick `date-field.native.tsx` on iOS and Android and
 * `date-field.web.tsx` on the web; neither implementation is reachable from the other's bundle.
 * This file exists so a plain `./date-field` import still has something to typecheck against, and
 * it points at the web half because that is the one a browser-based tool would run. Its export
 * surface is deliberately **identical** to both platform files — anything shared between them lives
 * in `date-field-shared.ts` and is exported from there, never through this file, because a name
 * re-exported here that only one platform file provides would break at runtime on the other. Same
 * technique, same reason, as `packages/i18n/src/direction.ts`.
 */
export { DateField } from './date-field.web.tsx';
export type { DateFieldProps } from './date-field-shared.ts';

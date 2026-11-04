/**
 * The module TypeScript, Node and any non-Metro tool resolve for `./auth-stage`.
 *
 * Metro picks `auth-stage.web.tsx` on the web and `auth-stage.native.tsx` on a phone; this file
 * exists only so a plain import has something to typecheck against, as
 * `features/catalogue/stage-ring.tsx` does.
 */
export { AuthStage } from './auth-stage.web.tsx';

/**
 * The module TypeScript, Node and any non-Metro tool resolve for `./address-map`.
 *
 * Metro picks `address-map.web.tsx` on the web and `address-map.native.tsx` on a phone; this file
 * exists only so a plain import has something to typecheck against, as `catalogue/stage-ring.tsx`
 * does.
 */
export { AddressMap } from './address-map.web.tsx';

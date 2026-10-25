import type { TFunction } from 'i18next';

import { pathnameOf } from '../../navigation/return-to.ts';
import { ENTITY_FAMILIES } from './entity-registry.ts';

/**
 * What the trail calls the page a reader was sent from — the crumb above the record, which takes
 * them back to it (`useKitchenTrailLeaf`'s parent label).
 *
 * A page opened as a detour — a recipe from Review or Stock gaps, an ingredient from a recipe — is
 * a route of its own family, but the reader came from somewhere else, and that is where the trail
 * should lead. The name comes from the family whose address the return is under: a list is called
 * what the sidebar calls it ("Review", "Stock gaps"); a record inside one is called by its own name
 * when the caller knows it ("Crispy Chicken Marination"), and by its family's otherwise.
 *
 * `null` when there is no return, or it is somewhere this workspace does not name.
 */
export function returnCrumbLabel(
    returnTo: string | null,
    t: TFunction,
    recordName?: string | null,
): string | null {
    if (returnTo === null) return null;
    const path = pathnameOf(returnTo);
    // The deepest family the return is under: `/kitchen/order-desk/calendar` is the calendar's.
    const family = ENTITY_FAMILIES.filter(
        (candidate) => path === candidate.href || path.startsWith(`${candidate.href}/`),
    ).sort((a, b) => b.href.length - a.href.length)[0];
    if (family === undefined) return null;
    if (path !== family.href && recordName != null && recordName !== '') return recordName;
    return t(family.nameKey);
}

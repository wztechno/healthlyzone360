import type { IconName } from '@healthy360/design-system';
import { can } from '@healthy360/permissions';
import type { AccessState } from '@healthy360/permissions';

/**
 * The kitchen workspace declared as data.
 *
 * Same idea as `navigation/items.ts`, and for the same two reasons. First, "which parts of this
 * workspace may this person see?" becomes a pure function of an `AccessState`, so it is
 * table-testable without rendering anything. Second, the hub cannot drift from the guards behind it:
 * the card grid and each screen's `<Gate>` read the same `permission` field, so a card is only ever
 * offered when the screen behind it would actually open.
 *
 * **This registry grows one entry per K1 slice.** K1.1 lands ingredients and the allergen-class
 * reference; recipes, products, price lists, meals, plans, zones and branch operating data append
 * here as their slices land, and nothing else about the hub changes when they do.
 */

/** Permission codes the K1 catalogue surfaces are gated on (master plan, phase K1). */
export const CATALOGUE_VIEW_PERMISSION = 'catalogue.view_organisation';
export const CATALOGUE_MANAGE_PERMISSION = 'catalogue.manage_organisation';

/**
 * How a family's card reports how much is in it.
 *
 * `managed` families are counted from their own listing and can carry a draft badge; `reference`
 * families are platform data a kitchen only reads, so a draft count would be meaningless and the
 * card says "reference" instead of inventing one.
 */
export const ENTITY_KINDS = ['managed', 'reference'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface EntityFamily {
    /** Stable across slices — it is the test id suffix and the card key. */
    readonly key: string;
    readonly kind: EntityKind;
    /** i18next key roots. Never a literal string. */
    readonly nameKey: string;
    readonly descriptionKey: string;
    readonly icon: IconName;
    readonly href: string;
    /** Permission required to see the card *and* to open the screen behind it. */
    readonly permission: string;
    /** Permission required to write. `null` for a family nobody can write from this workspace. */
    readonly managePermission: string | null;
}

export const ENTITY_FAMILIES: readonly EntityFamily[] = [
    {
        key: 'ingredients',
        kind: 'managed',
        nameKey: 'kitchen:families.ingredients.name',
        descriptionKey: 'kitchen:families.ingredients.description',
        icon: 'branch',
        href: '/kitchen/ingredients',
        permission: CATALOGUE_VIEW_PERMISSION,
        managePermission: CATALOGUE_MANAGE_PERMISSION,
    },
    {
        key: 'allergen-classes',
        kind: 'reference',
        nameKey: 'kitchen:families.allergenClasses.name',
        descriptionKey: 'kitchen:families.allergenClasses.description',
        icon: 'warning',
        href: '/kitchen/allergen-classes',
        permission: CATALOGUE_VIEW_PERMISSION,
        // Class governance is platform-level (decision D-041): nobody edits these from a kitchen.
        managePermission: null,
    },
];

/**
 * Every distinct permission the workspace's families are gated on.
 *
 * The hub route requires *one* of these rather than all of them, so a role that can only read the
 * allergen reference still gets a workspace rather than a refusal — and the card grid then shows it
 * exactly one card. Holding none of them is what produces the forbidden page.
 */
export const WORKSPACE_PERMISSIONS: readonly string[] = [
    ...new Set(ENTITY_FAMILIES.map((family) => family.permission)),
];

/** The families this state may actually reach, in display order. */
export function permittedFamilies(
    state: AccessState,
    families: readonly EntityFamily[] = ENTITY_FAMILIES,
): readonly EntityFamily[] {
    return families.filter((family) => can(state, family.permission));
}

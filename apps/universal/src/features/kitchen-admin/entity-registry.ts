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
 * reference, K1.2 recipes, K1.4 products and meals, K1.5 price lists, K1.6 plans, K1.7 delivery
 * zones and branch operating data — and nothing else about the hub changes when they do.
 *
 * ## Why the delivery slice is two cards and not one
 *
 * They are two *subjects*, not two views of one. A delivery zone is a record family: many of them,
 * created, edited, archived, each carrying its own areas and its own delivery windows. A branch's
 * operating week is a **single record belonging to the branch already in context** — one per branch,
 * no lifecycle, nothing to create. Folding them into one card would mean a card whose count answered
 * two different questions at once, and an "open" control that had to pick which of the two it meant.
 *
 * Delivery *windows* get no card, and that is the contract's shape rather than an omission:
 * `setDeliveryWindows` is keyed by zone, so a window is only ever edited inside the zone that owns
 * it (`data/kitchen-admin-hooks.ts`, gap 14).
 */

/**
 * Permission codes the K1 catalogue surfaces are gated on (master plan, phase K1).
 *
 * **TODO (K1 wiring pass).** The backend vocabulary is finer than this: `recipe.view_organisation`,
 * `recipe.manage_organisation` and `recipe.publish_organisation` are distinct codes server-side, and
 * publishing in particular is meant to be separately grantable. The mock's roles grant neither, so
 * gating the recipe family on them today would hide a whole slice behind a permission nothing can
 * issue. The recipe surfaces therefore reuse the catalogue pair, and the reconciliation pass that
 * lands the real codes changes this file and nothing else — which is the reason the registry exists.
 *
 * The same holds for the product and meal families landed by K1.4: the plan's permission set names
 * `catalogue.*` codes finer than this pair — publication of a meal is a distinct grant from renaming
 * one — and none of them is issuable in this world yet. Two constants, one reconciliation.
 */
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
        key: 'recipes',
        kind: 'managed',
        nameKey: 'kitchen:families.recipes.name',
        descriptionKey: 'kitchen:families.recipes.description',
        // `▤`, the ruled sheet. The icon set has no recipe glyph and adding one is a design-system
        // change, not a slice's; this is the closest honest reading — a technical sheet.
        icon: 'calendar',
        href: '/kitchen/recipes',
        // See the note on the permission constants: `recipe.*` exists server-side and nothing in
        // this world can grant it yet.
        permission: CATALOGUE_VIEW_PERMISSION,
        managePermission: CATALOGUE_MANAGE_PERMISSION,
    },
    {
        key: 'products',
        kind: 'managed',
        nameKey: 'kitchen:families.products.name',
        descriptionKey: 'kitchen:families.products.description',
        // `▭`, a rectangle — a pack seen face on. The icon set is a table of typographic glyphs
        // with no box, carton or bag in it, so this is the closest honest reading; the glyph is
        // registered under the name `device` because that is the other place a rectangle was
        // wanted first, not because a product is a device. A real icon set retires the compromise.
        icon: 'device',
        href: '/kitchen/products',
        // See the note on the permission constants: no `product.*` code exists that this world can
        // grant, so the product surfaces reuse the catalogue pair with the rest of K1.
        permission: CATALOGUE_VIEW_PERMISSION,
        managePermission: CATALOGUE_MANAGE_PERMISSION,
    },
    {
        key: 'meals',
        kind: 'managed',
        nameKey: 'kitchen:families.meals.name',
        descriptionKey: 'kitchen:families.meals.description',
        // `◉`, a filled disc inside a ring — a plate seen from above. Same compromise as the
        // product glyph: the character is registered as `eye`, which is also the confidential
        // badge's icon elsewhere in this workspace. The two never appear together, and the label
        // beside the card is what carries the meaning; a food glyph is a design-system change.
        icon: 'eye',
        href: '/kitchen/meals',
        permission: CATALOGUE_VIEW_PERMISSION,
        managePermission: CATALOGUE_MANAGE_PERMISSION,
    },
    {
        key: 'price-lists',
        kind: 'managed',
        nameKey: 'kitchen:families.priceLists.name',
        descriptionKey: 'kitchen:families.priceLists.description',
        // `☰`, three stacked rules — a schedule of priced rows. The same compromise the product and
        // meal glyphs record, and for a sharper reason here: the icon set is a table of typographic
        // characters with no money glyph in it, and any currency sign that could stand in would name
        // *one* currency on a family whose whole point is that each list carries its own.
        icon: 'menu',
        href: '/kitchen/price-lists',
        // See the note on the permission constants: the plan names `price_list.*` codes server-side
        // and nothing in this world can grant one, so K1.5 reuses the catalogue pair with the rest
        // of K1 and the reconciliation pass changes this file alone.
        permission: CATALOGUE_VIEW_PERMISSION,
        managePermission: CATALOGUE_MANAGE_PERMISSION,
    },
    {
        key: 'plans',
        kind: 'managed',
        nameKey: 'kitchen:families.plans.name',
        descriptionKey: 'kitchen:families.plans.description',
        // `▤`, the ruled sheet — the same glyph the recipe family carries, and the sharpest
        // instance yet of the compromise those cards already record: the icon set is a table of
        // typographic characters with no grid, calendar-of-deliveries or matrix glyph in it, and
        // every other character in it is either taken by another card or would say something
        // untrue (`⟳` reads as a reload control, `◈` is the organisation switcher's own mark).
        // A plan is a ruled table of configurations and a schedule of deliveries, so this is the
        // closest honest reading; the label beside the card is what separates it from the recipe
        // book, and a real icon set retires the compromise for both.
        icon: 'calendar',
        href: '/kitchen/plans',
        // See the note on the permission constants: the plan names `subscription_plan.*` codes
        // server-side and nothing in this world can grant one, so K1.6 reuses the catalogue pair
        // with the rest of K1 and the reconciliation pass changes this file alone.
        permission: CATALOGUE_VIEW_PERMISSION,
        managePermission: CATALOGUE_MANAGE_PERMISSION,
    },
    {
        key: 'delivery-zones',
        kind: 'managed',
        nameKey: 'kitchen:families.deliveryZones.name',
        descriptionKey: 'kitchen:families.deliveryZones.description',
        // `⚟`, a wedge of converging lines — a map pin, read as generously as this icon set allows.
        // The same compromise the product, meal, price-list and plan cards record: there is no map,
        // pin or region glyph in a table of typographic characters, and every alternative either
        // belongs to another card or says something untrue. The character is registered as `filter`
        // because a funnel was wanted first; a delivery zone is not a filter, and the label beside
        // the card is what carries the meaning until a real icon set retires the compromise.
        icon: 'filter',
        href: '/kitchen/delivery-zones',
        // See the note on the permission constants: the plan names `delivery_zone.*` codes
        // server-side and nothing in this world can grant one, so K1.7 reuses the catalogue pair
        // with the rest of K1 and the reconciliation pass changes this file alone.
        permission: CATALOGUE_VIEW_PERMISSION,
        managePermission: CATALOGUE_MANAGE_PERMISSION,
    },
    {
        key: 'branch-operating',
        kind: 'managed',
        nameKey: 'kitchen:families.branchOperating.name',
        descriptionKey: 'kitchen:families.branchOperating.description',
        // `▤`, the ruled sheet — a trading week is a timetable, which is the most literal reading
        // this glyph has anywhere in the workspace. It is the third card to carry it (recipes and
        // plans are the others) and the compromise those two record applies unchanged.
        icon: 'calendar',
        href: '/kitchen/branch-operating',
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

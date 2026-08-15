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
 * zones and branch operating data, K1.8 the review queue — and nothing else about the hub changes
 * when they do.
 *
 * ## Why the review queue is first, and is an entry here at all
 *
 * It is listed before every family because it is the only card that answers "what should I do
 * *now*?" — everything below it answers "where do I go?". And it is a registry entry rather than a
 * banner bolted onto the hub because the hub's grid is data-driven precisely so that a new surface
 * costs one object: the card, its permission gate and its heading all come from this row, exactly as
 * the seven families' do.
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
 * Fine-grained codes match the backend PermissionRegistry. Mock kitchen_manager
 * (and the real kitchen_manager template role) grant the full set.
 */
export const CATALOGUE_VIEW_PERMISSION = 'catalogue.view_organisation';
export const CATALOGUE_MANAGE_PERMISSION = 'catalogue.manage_organisation';
export const CATALOGUE_PUBLISH_PERMISSION = 'catalogue.publish_organisation';
export const RECIPE_VIEW_PERMISSION = 'recipe.view_organisation';
export const RECIPE_MANAGE_PERMISSION = 'recipe.manage_organisation';
export const PRICE_LIST_VIEW_PERMISSION = 'price_list.view_organisation';
export const PRICE_LIST_MANAGE_PERMISSION = 'price_list.manage_organisation';
export const PLAN_MANAGE_PERMISSION = 'plan.manage_organisation';
export const DELIVERY_ZONE_MANAGE_PERMISSION = 'delivery_zone.manage_organisation';
/**
 * The order book's own pair (O6). Deliberately *not* the catalogue codes the other operations
 * surfaces borrow: this family reads a named customer's delivery address and writes an order's
 * lifecycle, so "may edit the menu" is the wrong question to ask before opening it.
 */
export const ORDER_VIEW_PERMISSION = 'order.view_organisation';
export const ORDER_MANAGE_PERMISSION = 'order.manage_organisation';

/**
 * The B2B quotation pair (B4), split for the reason `price_list.*` was split in K1.5: seeing what a
 * corporate buyer submitted and deciding what to charge them for it are different authorities, and
 * the backend grants both only to `kitchen_manager` and `commercial_manager`.
 *
 * Deliberately not the `order.*` codes the family sits beside in this registry. An order is a sale
 * at a price already agreed; a quotation is the negotiation that fixes one, against a named buyer
 * organisation under a signed agreement — "may cancel somebody's dinner" is the wrong question to
 * ask before opening it.
 */
export const B2B_QUOTATION_VIEW_PERMISSION = 'b2b_quotation.view_organisation';
export const B2B_QUOTATION_QUOTE_PERMISSION = 'b2b_quotation.quote_organisation';

/**
 * The cost permission (INV1.1). It gates every money-bearing inventory surface exactly as
 * `recipe.view_costs_organisation` gates recipe costs — here, the purchases ledger. A kitchen hand
 * who counts stock and posts receipts does not thereby see what those receipts cost.
 */
export const INVENTORY_VIEW_COSTS_PERMISSION = 'inventory.view_costs_organisation';

/**
 * The plain inventory read/write pair (INV1.0). The consumption-exception review surface (INV1.5)
 * gates on these — reading the queue is `inventory.view_organisation`, and settling or retrying an
 * item is `inventory.manage_organisation` — rather than the cost code, because an exception names a
 * sale and a stock gap, not a valuation. No money passes through the review surface.
 */
export const INVENTORY_VIEW_PERMISSION = 'inventory.view_organisation';
export const INVENTORY_MANAGE_PERMISSION = 'inventory.manage_organisation';

/**
 * How a family's card reports how much is in it.
 *
 * `managed` families are counted from their own listing and can carry a draft badge; `reference`
 * families are platform data a kitchen only reads, so a draft count would be meaningless and the
 * card says "reference" instead of inventing one.
 *
 * `workbench` is neither, and K1.8 added it for the one entry that needed it. The review queue is
 * not a family of records — it is a **view across six of them**, it has no listing of its own, no
 * create control and no lifecycle. Filing it as `managed` would have promised a draft count it
 * cannot have; filing it as `reference` would have called a work queue read-only reference data.
 * The registry stays the single source of "what is in this workspace" either way, which is the whole
 * reason the third value is cheaper than a special case in the hub.
 */
export const ENTITY_KINDS = ['managed', 'reference', 'workbench'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * Hub and kitchen-rail sectioning. Order here is display order for grouped nav and the hub grid.
 *
 * `workbench` is the "what now?" queue; `catalogue` is what goes into a dish; `commercial` is what
 * a customer is charged and where it is delivered; `operations` is stock through QC (ops panels).
 */
export const ENTITY_GROUPS = ['workbench', 'catalogue', 'commercial', 'operations'] as const;
export type EntityGroup = (typeof ENTITY_GROUPS)[number];

export interface EntityFamily {
    /** Stable across slices — it is the test id suffix and the card key. */
    readonly key: string;
    readonly kind: EntityKind;
    /** Section this family belongs to in the ops shell and hub. */
    readonly group: EntityGroup;
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
        key: 'review',
        kind: 'workbench',
        group: 'workbench',
        nameKey: 'kitchen:families.review.name',
        descriptionKey: 'kitchen:families.review.description',
        // `⌕`, the magnifier — an inspection, which is literally what this card opens. Every other
        // card in this workspace records the same compromise (the icon set is a table of typographic
        // characters), and this one has a sharper constraint than most: `⚠` would have been the
        // obvious reading, and it is already the allergen-class card's glyph. Two cards wearing the
        // same warning sign, one meaning "the fourteen regulatory classes" and the other meaning
        // "these records are blocked", would be worse than a magnifier.
        icon: 'search',
        href: '/kitchen/review',
        // Deliberately the *view* permission and not the manage one: a person who may read the
        // catalogue may see what is blocking it, and resolving a blocker is gated by the editor the
        // row links into rather than by the queue that names it (plan §4.7, K1.8).
        permission: CATALOGUE_VIEW_PERMISSION,
        // Nothing is written from the queue. Every fix happens in the family's own editor, which is
        // where the lock version, the unsaved guard and the publish confirmation already live.
        managePermission: null,
    },
    {
        key: 'analytics',
        kind: 'workbench',
        group: 'workbench',
        nameKey: 'kitchen:families.analytics.name',
        descriptionKey: 'kitchen:families.analytics.description',
        // `▤`, the ruled sheet — closest glyph for a dashboard of figures until a chart icon lands.
        icon: 'calendar',
        href: '/kitchen/analytics',
        permission: CATALOGUE_VIEW_PERMISSION,
        managePermission: null,
    },
    {
        key: 'cost-report',
        kind: 'workbench',
        group: 'workbench',
        nameKey: 'kitchen:families.costReport.name',
        descriptionKey: 'kitchen:families.costReport.description',
        // `☰`, three stacked rules — a ledger of monthly figures, the same reading the purchases and
        // price-list cards give the glyph. A real icon set retires the compromise the whole
        // workspace records.
        icon: 'menu',
        href: '/kitchen/cost-report',
        // The second card gated on the cost permission (INV1.1), and for the same reason as the
        // purchases ledger: this report exposes spend, COGS and the margin reconstructable from
        // cost and revenue, so a person without `inventory.view_costs_organisation` never sees it.
        // Unlike analytics — sample figures behind the plain view code — this is real money, so it
        // takes the money code. Nothing is written from a report.
        permission: INVENTORY_VIEW_COSTS_PERMISSION,
        managePermission: null,
    },
    {
        key: 'consumption-exceptions',
        kind: 'workbench',
        group: 'workbench',
        nameKey: 'kitchen:families.consumptionExceptions.name',
        descriptionKey: 'kitchen:families.consumptionExceptions.description',
        // `⚠`, the warning sign — these are the deductions that could not be made honestly, a work
        // queue of stock gaps. It is the allergen card's glyph too, but the two never share a group
        // and the label beside the card carries the meaning; a real icon set retires the compromise.
        icon: 'warning',
        href: '/kitchen/consumption-exceptions',
        // The review surface reads on `inventory.view_organisation` (the queue) and writes on
        // `inventory.manage_organisation` (resolve/retry). Not the cost code — no money is shown here,
        // only which sale on which line could not be deducted and why.
        permission: INVENTORY_VIEW_PERMISSION,
        managePermission: INVENTORY_MANAGE_PERMISSION,
    },
    {
        key: 'ingredients',
        kind: 'managed',
        group: 'catalogue',
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
        group: 'catalogue',
        nameKey: 'kitchen:families.recipes.name',
        descriptionKey: 'kitchen:families.recipes.description',
        // `▤`, the ruled sheet. The icon set has no recipe glyph and adding one is a design-system
        // change, not a slice's; this is the closest honest reading — a technical sheet.
        icon: 'calendar',
        href: '/kitchen/recipes',
        permission: RECIPE_VIEW_PERMISSION,
        managePermission: RECIPE_MANAGE_PERMISSION,
    },
    {
        key: 'products',
        kind: 'managed',
        group: 'catalogue',
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
        group: 'catalogue',
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
        key: 'allergen-classes',
        kind: 'reference',
        group: 'catalogue',
        nameKey: 'kitchen:families.allergenClasses.name',
        descriptionKey: 'kitchen:families.allergenClasses.description',
        icon: 'warning',
        href: '/kitchen/allergen-classes',
        permission: CATALOGUE_VIEW_PERMISSION,
        managePermission: null,
    },
    {
        key: 'price-lists',
        kind: 'managed',
        group: 'commercial',
        nameKey: 'kitchen:families.priceLists.name',
        descriptionKey: 'kitchen:families.priceLists.description',
        // `☰`, three stacked rules — a schedule of priced rows. The same compromise the product and
        // meal glyphs record, and for a sharper reason here: the icon set is a table of typographic
        // characters with no money glyph in it, and any currency sign that could stand in would name
        // *one* currency on a family whose whole point is that each list carries its own.
        icon: 'menu',
        href: '/kitchen/price-lists',
        permission: PRICE_LIST_VIEW_PERMISSION,
        managePermission: PRICE_LIST_MANAGE_PERMISSION,
    },
    {
        key: 'quotations',
        kind: 'managed',
        group: 'commercial',
        nameKey: 'kitchen:families.quotations.name',
        descriptionKey: 'kitchen:families.quotations.description',
        // `☰`, three stacked rules — the price-list glyph, deliberately. A quotation *is* a schedule
        // of priced rows; the only difference is that it is addressed to one buyer under one
        // agreement rather than published to a channel. The card sits beside price lists for the
        // same reason, and the compromise that entry records (no money glyph exists in a table of
        // typographic characters, and any currency sign would name one currency on a family whose
        // rows each carry their own) applies here word for word.
        icon: 'menu',
        href: '/kitchen/quotations',
        permission: B2B_QUOTATION_VIEW_PERMISSION,
        managePermission: B2B_QUOTATION_QUOTE_PERMISSION,
    },
    {
        key: 'plans',
        kind: 'managed',
        group: 'commercial',
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
        permission: CATALOGUE_VIEW_PERMISSION,
        managePermission: PLAN_MANAGE_PERMISSION,
    },
    {
        key: 'delivery-zones',
        kind: 'managed',
        group: 'commercial',
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
        permission: CATALOGUE_VIEW_PERMISSION,
        managePermission: DELIVERY_ZONE_MANAGE_PERMISSION,
    },
    {
        key: 'branch-operating',
        kind: 'managed',
        group: 'commercial',
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
        key: 'orders',
        kind: 'managed',
        group: 'operations',
        nameKey: 'kitchen:families.orders.name',
        descriptionKey: 'kitchen:families.orders.description',
        // `☰`, three stacked rules — a docket of ordered lines, which is literally what an order
        // ticket is. It is the third card to carry the glyph (price lists and stock are the others)
        // and the compromise those two record applies unchanged: the icon set is a table of
        // typographic characters with no receipt, bag or ticket in it, and every alternative either
        // belongs to another card or says something untrue (`✓` would call a queue of work "done").
        icon: 'menu',
        href: '/kitchen/orders',
        // First among the operations entries because it is the operational front door: stock,
        // procurement, production and QC all exist to answer what this list is asking for.
        permission: ORDER_VIEW_PERMISSION,
        managePermission: ORDER_MANAGE_PERMISSION,
    },
    {
        key: 'stock',
        kind: 'managed',
        group: 'operations',
        nameKey: 'kitchen:families.stock.name',
        descriptionKey: 'kitchen:families.stock.description',
        icon: 'menu',
        href: '/kitchen/stock',
        // INV1.0 gave the ops surface its own domain, but the stock, procurement, production and QC
        // families kept the `catalogue.*` piggyback the routes shed. Re-pointed here so the hub tile
        // and nav gate match the screen's own `<Gate>` and the backend route: an operator counts and
        // moves stock under `inventory.*`, not because they may edit the menu.
        permission: INVENTORY_VIEW_PERMISSION,
        managePermission: INVENTORY_MANAGE_PERMISSION,
    },
    {
        key: 'procurement',
        kind: 'managed',
        group: 'operations',
        nameKey: 'kitchen:families.procurement.name',
        descriptionKey: 'kitchen:families.procurement.description',
        icon: 'branch',
        href: '/kitchen/procurement',
        permission: INVENTORY_VIEW_PERMISSION,
        managePermission: INVENTORY_MANAGE_PERMISSION,
    },
    {
        key: 'purchases',
        kind: 'managed',
        group: 'operations',
        nameKey: 'kitchen:families.purchases.name',
        descriptionKey: 'kitchen:families.purchases.description',
        // `☰`, three stacked rules — a schedule of priced rows, the same reading the price-list and
        // order cards give it. The purchases ledger is a ledger of lines with a total, so the glyph
        // is honest; the label beside the card separates it, and a real icon set retires the
        // compromise the whole workspace records.
        icon: 'menu',
        href: '/kitchen/purchases-ledger',
        // The one card in the workspace gated on the cost permission (INV1.1): the ledger *is* the
        // valuation, so a person without `inventory.view_costs_organisation` never sees the card and
        // the screen behind it refuses. There is nothing to write from a ledger.
        permission: INVENTORY_VIEW_COSTS_PERMISSION,
        managePermission: null,
    },
    {
        key: 'production',
        kind: 'managed',
        group: 'operations',
        nameKey: 'kitchen:families.production.name',
        descriptionKey: 'kitchen:families.production.description',
        icon: 'calendar',
        href: '/kitchen/production',
        permission: INVENTORY_VIEW_PERMISSION,
        managePermission: INVENTORY_MANAGE_PERMISSION,
    },
    {
        key: 'qc',
        kind: 'managed',
        group: 'operations',
        nameKey: 'kitchen:families.qc.name',
        descriptionKey: 'kitchen:families.qc.description',
        icon: 'search',
        href: '/kitchen/qc',
        permission: INVENTORY_VIEW_PERMISSION,
        managePermission: INVENTORY_MANAGE_PERMISSION,
    },
];

/** Families in a group, in registry order. */
export function familiesInGroup(
    group: EntityGroup,
    families: readonly EntityFamily[] = ENTITY_FAMILIES,
): readonly EntityFamily[] {
    return families.filter((family) => family.group === group);
}

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

import type {
    AllergenCode,
    CurrencyCode,
    DeliveryWindowId,
    DeliveryZoneId,
    DietClassification,
    IngredientId,
    IsoDateTime,
    KitchenBranchId,
    KitchenId,
    MealId,
    MealType,
    OrganisationId,
    PlanVariantId,
    PriceListId,
    ProductId,
    RecipeId,
    RecipeVersionId,
    SalesChannel,
    ServiceAreaId,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import type { MeasureUnit, NutritionFacts, Serving } from '@healthy360/nutrition';

import type { CursorPage, CursorPageRequest, OffsetPageRequest } from './pagination.ts';

/**
 * The kitchen-management contract (phase K1).
 *
 * **Proposed, not implemented.** The endpoints behind it are the catalogue-management families of
 * the master plan's appendix C §D; `api/prototype-repositories.ts` names each one it *would* have
 * called. A screen depends on this interface, gets the mutable mock world today and the API
 * repository per slice, and does not change.
 *
 * ## What makes this contract different from every other one in this folder
 *
 * 1. **It is the confidential side of the catalogue.** Purchase costs, technical-sheet cost lines
 *    and margins exist here and *only* here. `./marketplace.ts` and `./business.ts` have no field
 *    for any of them, and that absence — not a filter, not a permission check in a screen — is what
 *    makes a leak a compile error rather than a review finding (plan §4.8).
 * 2. **Every entity carries both languages.** A consumer shape carries a single, server-localised
 *    `name`; an admin shape carries {@link LocalisedText}, because the person editing it is
 *    responsible for both and a form that hides one of them cannot be used to fix it (plan §4.18).
 * 3. **Every write is lock-versioned.** Reads hand back {@link AdminEntityMeta}; writes hand the
 *    version back with the change, and the server rejects a stale one with `resource.conflict`
 *    carrying `currentLockVersion` (plan §4.13). On the wire this is `ETag` / `If-Match`; in the
 *    contract it is one required number, so a caller cannot forget it.
 * 4. **Lifecycle actions are their own methods.** `publishMeal`, `retirePlan`, `archiveZone` —
 *    never a status field on an update request (plan §4.15). Each is a distinct permission and a
 *    distinct audit action on the server, and a contract that let a status be `PATCH`ed would make
 *    that impossible to enforce.
 */

/* ------------------------------------------------------------------------------------------------
 * Shared vocabulary
 * ---------------------------------------------------------------------------------------------- */

/**
 * The publication lifecycle of anything a consumer can eventually see (plan §4.7).
 *
 * `review_required` is a **quarantine**, not a queue position. It is what a critical allergen
 * conflict sets — the master plan's worked example is the source data's burghul and pita rows,
 * tagged "no allergens" by a sheet whose own key says otherwise — and publication is refused from
 * it structurally. A person clears the conflict; nobody overrides the state.
 *
 * `retired` is terminal for consumer visibility: a retired row keeps its history and disappears
 * from every consumer read. There is no `deleted`; the catalogue never loses a row that an order
 * or a cost snapshot might point at.
 */
export const PUBLISHABLE_STATUSES = ['draft', 'review_required', 'published', 'retired'] as const;
export type PublishableStatus = (typeof PUBLISHABLE_STATUSES)[number];

/** Statuses a consumer surface may read. Everything else is invisible outside the kitchen. */
export const CONSUMER_VISIBLE_STATUSES: readonly PublishableStatus[] = ['published'];

export function isConsumerVisible(status: PublishableStatus): boolean {
    return CONSUMER_VISIBLE_STATUSES.includes(status);
}

/**
 * A bilingual field.
 *
 * Both languages are required rather than `string | null`, because the readiness evaluator refuses
 * to publish a row whose translations are incomplete (plan §4.7) and a shape that made `ar`
 * optional would let a form save something that can never be published without saying so.
 */
export interface LocalisedText {
    readonly en: string;
    readonly ar: string;
}

/** The bookkeeping every lock-versioned management record carries. */
export interface AdminRecordMeta {
    /** Increments on every accepted write. The `If-Match` value for the next one. */
    readonly lockVersion: number;
    readonly updatedAt: IsoDateTime;
    /** Display name of whoever last wrote it; `null` for a row a seeder or an import created. */
    readonly updatedByName: string | null;
}

/** {@link AdminRecordMeta} plus the publication state, for records a consumer can eventually see. */
export interface AdminEntityMeta extends AdminRecordMeta {
    readonly status: PublishableStatus;
}

/**
 * The minimum a write needs: the version it was based on.
 *
 * Present on every mutating request rather than passed as a header parameter, so that adding a
 * mutation to this contract without a version is a compile error instead of a runtime `428`.
 */
export interface LockedRequest {
    readonly lockVersion: number;
}

/**
 * A calculated cost, in **major** currency units (plan §4.4).
 *
 * Deliberately not `Money`. `Money` is an integer count of minor units and is the type every
 * *price* uses; a cost is a `decimal(18,6)` that comes from dividing a purchase price by a yield,
 * and rounding it into fils at every step would make a technical sheet disagree with itself.
 * Keeping the two types apart is what lets an architecture test forbid summing one into the other.
 */
export interface CostAmount {
    /** Major units, e.g. `3.9` is three dirhams ninety fils. Never minor units. */
    readonly amount: number;
    readonly currency: CurrencyCode;
}

/** Decimal places a cost is stored and compared at. */
export const COST_DECIMAL_PLACES = 6;

/**
 * Which sellable thing a price, an availability rule or a catalogue assignment points at.
 *
 * A discriminated union rather than a `kind` plus a bare string identifier: products, meals and
 * plans have separate brands precisely so they cannot be transposed, and flattening them into one
 * `itemId: string` would throw that away at the one place it matters most — pricing.
 */
export type CatalogueItemRef =
    | { readonly kind: 'product'; readonly productId: ProductId; readonly packCode: string | null }
    | { readonly kind: 'meal'; readonly mealId: MealId }
    | {
          readonly kind: 'plan';
          readonly planId: SubscriptionPlanId;
          /** `null` prices the plan itself; a variant identifier prices one configuration of it. */
          readonly variantId: PlanVariantId | null;
      };

/** Per-channel switch for anything sold through more than one route to market. */
export interface ChannelAvailability {
    readonly channel: SalesChannel;
    readonly isAvailable: boolean;
    /** `YYYY-MM-DD`, or `null` for "as soon as it is published" / "indefinitely". */
    readonly availableFrom: string | null;
    readonly availableUntil: string | null;
}

/* ------------------------------------------------------------------------------------------------
 * Platform reference data — read-only in a kitchen workspace
 * ---------------------------------------------------------------------------------------------- */

/**
 * One of the canonical allergen classes.
 *
 * **Codes are immutable regulatory identities** (plan §4.6). The platform owns the display names,
 * the market applicability, the thresholds and the deactivation switch; a kitchen owns only its own
 * *mappings* from ingredients onto these codes. Nothing in this contract can rename a code, delete
 * one, or invent a fifteenth — which is why this family is a single read method with no writer.
 */
export interface AllergenClass {
    readonly code: AllergenCode;
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    /**
     * Market codes whose labelling regime requires this class to be declared, e.g. `EU`, `US`,
     * `GCC`. A class that a market does not regulate is still listed — with that market absent —
     * rather than hidden, because "not required here" is a fact a kitchen needs to see.
     */
    readonly markets: readonly string[];
    /**
     * The declaration threshold a regime states, when it states one — sulphites are declarable at
     * 10 mg/kg, most classes at any detectable amount. `null` means "any amount".
     */
    readonly declarationThreshold: { readonly value: number; readonly unit: string } | null;
    /** The regulation the class comes from, as the platform records it. Never inferred. */
    readonly regulatoryReference: string;
    /** True for the classes where a trace exposure can be dangerous. Drives the strongest warning. */
    readonly severeByDefault: boolean;
    /** Withdrawn classes are deactivated, never deleted; historic labels still resolve. */
    readonly isActive: boolean;
}

/**
 * One row of the delivery-area gazetteer.
 *
 * Platform reference data (K1.7): a zone selects areas from it, and a customer address later
 * *points at* one rather than carrying free text that a string match has to guess about.
 */
export interface ServiceArea {
    readonly id: ServiceAreaId;
    readonly name: LocalisedText;
    readonly countryCode: string;
    /** Governorate, emirate or city the area sits in; `null` at the top of the hierarchy. */
    readonly parentName: LocalisedText | null;
    readonly isActive: boolean;
}

export interface ServiceAreaFilter extends CursorPageRequest {
    readonly query?: string | undefined;
    readonly countryCode?: string | undefined;
}

/* ------------------------------------------------------------------------------------------------
 * Ingredients and allergen mappings
 * ---------------------------------------------------------------------------------------------- */

/**
 * Whether an allergen is *in* the ingredient or *may be* in it.
 *
 * Two values and no third. "Free from" is the absence of a mapping, and adding it as a value would
 * create two ways to say the same thing — one of which a filter would eventually forget to check.
 */
export const ALLERGEN_CONTAINMENTS = ['contains', 'may_contain'] as const;
export type AllergenContainment = (typeof ALLERGEN_CONTAINMENTS)[number];

/** How well established a mapping is. Ordered weakest to strongest. */
export const ALLERGEN_VERIFICATIONS = [
    'unverified',
    'supplier_declared',
    'laboratory_tested',
    'operator_confirmed',
] as const;
export type AllergenVerification = (typeof ALLERGEN_VERIFICATIONS)[number];

export interface IngredientAllergenMapping {
    readonly allergenCode: AllergenCode;
    readonly containment: AllergenContainment;
    /**
     * Markets the mapping applies in. Empty means every market — the common case. A non-empty list
     * is how "coconut counts as a tree nut in the United States and nowhere else" is expressible
     * without a second allergen code.
     */
    readonly marketScope: readonly string[];
    readonly verification: AllergenVerification;
    /** Where the determination came from — a supplier specification, a test report, a person. */
    readonly sourceNote: string | null;
}

/**
 * An ingredient as its kitchen sees it.
 *
 * `costPer100g` is **confidential** and has no counterpart in `./foods.ts`: the consumer `Food`
 * shape carries facts and allergens and no purchase price at all.
 */
/**
 * One node of the ingredient category tree.
 *
 * `ingredient_categories` is a single self-referencing table, so a parent and a leaf are the same
 * shape and `parentCode` is the only thing that separates them: `null` is a top-level category,
 * anything else is a sub-category of that code.
 *
 * This is the declared vocabulary, not an observed one. The distinction matters: the pickers used
 * to derive both lists from a page of ingredients — the codes actually in use — which meant a
 * sub-category nobody had filed anything under yet did not exist as far as the editor was
 * concerned, and one that only appeared on page four of the library did not exist either. Reading
 * the tree means every leaf is offerable the moment it is created, whether or not anything sits
 * under it.
 */
export interface IngredientCategoryAdmin {
    readonly code: string;
    readonly name: LocalisedText;
    /** `null` for a top-level category; otherwise the code of the parent it hangs from. */
    readonly parentCode: string | null;
    /** The order the catalogue wants them listed in. Ties fall back to the label. */
    readonly displayOrder: number;
    /** A retired branch stays on the wire so existing rows still resolve a name for it. */
    readonly isActive: boolean;
}

export interface IngredientAdmin {
    readonly id: IngredientId;
    readonly meta: AdminEntityMeta;
    readonly name: LocalisedText;
    /** The kitchen's own reference, e.g. `IG-014`. `null` for a platform-library row. */
    readonly reference: string | null;
    readonly categoryCode: string;
    /**
     * The leaf the ingredient is filed under, `null` when it is filed at the top level.
     *
     * Separate from {@link categoryCode} rather than folded into it. `ingredient_categories` is one
     * self-referencing table, and the two ids used to be collapsed into a single code with the
     * child preferred — which read back fine and then wrote the *child's* id into the parent column
     * on the next save, because the write layer only ever sent one of the two. Two fields in, two
     * ids out, and the pair stays the pair.
     */
    readonly subcategoryCode: string | null;
    /** The unit the kitchen issues it in. */
    readonly measurementUnit: MeasureUnit;
    /** The pack the kitchen buys it in, when recorded. */
    readonly purchaseUnit: MeasureUnit | null;
    /** Coarse "Made From" transcription from the source workbook, kitchen-facing. */
    readonly composition: string | null;
    /** Pieces per purchase pack, when the source knows it. */
    readonly itemsPerUnit: number | null;
    /**
     * CONFIDENTIAL — what the kitchen pays for one **purchase pack**, not one issued unit.
     *
     * Per {@link purchaseUnit}: a sleeve at $6.50, never a bag at $0.065. Deliberately a different
     * field from {@link unitPrice} beside it, which is per *stock unit* — the two are denominated
     * differently and confusing them scales a cost by {@link itemsPerUnit}, silently. A recipe
     * consuming a single bag divides this by that.
     *
     * Carried by packaging in practice, and `null` on food, which records its cost through
     * {@link costPer100g} instead.
     */
    readonly purchasePrice: CostAmount | null;
    /**
     * Proportion discarded, as a percentage. `null` and `0` are different answers — "nobody has
     * measured this" against "measured, and there is none".
     *
     * Packaging's figure. Food states its loss as a yield on the recipe line instead.
     */
    readonly wastePercent: number | null;
    /**
     * How much product one item holds, in the *recipe's* own unit rather than the container's
     * nominal volume — a 300 cc bottle carries `0.3` kg of sauce.
     *
     * Same-unit arithmetic on purpose: a nominal volume would need a density to become a mass, and
     * a missing density is the kind of gap that silently produces a plausible wrong number. `null`
     * on food, and on the packaging that holds nothing measurable — a label, a cap.
     */
    readonly capacity: { readonly quantity: number; readonly unit: MeasureUnit } | null;
    /** CONFIDENTIAL — purchase cost of 100 g, major units. `null` when no cost is recorded. */
    readonly costPer100g: CostAmount | null;
    /**
     * Trade list price on the article, `null` when none is recorded.
     *
     * A list price, not a cost and not a tariff: what this ingredient is
     * offered at, rather than what a kitchen paid (`costPer100g`, which moves
     * with every receipt) or what a channel charges on a date (a price list).
     * On a platform-library row it is one price for every kitchen.
     */
    readonly b2bPrice: CostAmount | null;
    /** Consumer list price on the article; the counterpart to `b2bPrice`. */
    readonly b2cPrice: CostAmount | null;
    /**
     * List price of one stock unit, `null` when none is recorded.
     *
     * The figure an operator types onto the ingredient sheet, and the denominator the editor's
     * margin readout divides `b2bPrice` by. Still a list price: `costPer100g` is what a kitchen
     * actually paid, and it moves with every receipt.
     */
    readonly unitPrice: CostAmount | null;
    /**
     * Offered for sale as-is, outside recipes.
     *
     * Not the same question as `availabilityTier` on the wire, which is about how hard the thing is
     * to source. An ingredient is a raw material until somebody says otherwise, so this is false
     * rather than null when nothing has been decided.
     */
    readonly isSellable: boolean;
    /** Per-100 g reference facts, when the ingredient has any. Never fabricated to fill the field. */
    readonly per100g: NutritionFacts | null;
    readonly allergens: readonly IngredientAllergenMapping[];
    readonly dietClassifications: readonly DietClassification[];
    /** Alternative designations seen on delivery notes and technical sheets. */
    readonly aliases: readonly string[];
    /** `null` for the shared platform library; set once a kitchen forks the row. */
    readonly organisationId: OrganisationId | null;
    /**
     * Whether this caller may write this row — the flag a screen gates its edit controls on.
     *
     * Not derivable from {@link organisationId}. A null organisation means "platform library",
     * which a kitchen reads and the platform operator writes, so the same row is editable or not
     * depending on who asked. Screens that inferred read-only from `organisationId === null` left
     * the shared library with no writer anywhere in the product.
     */
    readonly isEditable: boolean;
    /**
     * The library row this one was forked from, or `null` for a row that is
     * nobody's copy — every platform row, and anything a kitchen typed itself.
     *
     * On the wire so the editor can say *why* a row it can edit looks identical
     * to one in the shared library, and so a kitchen can find its way back to
     * the original it diverged from.
     */
    readonly forkedFromId: IngredientId | null;
    readonly notes: string | null;
}

/* ------------------------------------------------------------------------------------------------
 * Packaging
 *
 * Packaging has no types of its own. It is an {@link IngredientAdmin} filed under
 * {@link PACKAGING_CATEGORY_CODE}, and the three fields it needs that food does not —
 * `purchasePrice`, `wastePercent`, `capacity` — sit on that interface, null on food.
 *
 * It had its own table, its own status enum and its own eight repository methods for one
 * slice. What that bought was a guarantee no query could return a bin liner by accident; what
 * it cost was two of everything, and a `PackagingStatus` that turned out to be the ingredient
 * vocabulary spelled again. The guarantee is now the pair below: one list asks for the branch,
 * the other excludes it, and neither is expressible without naming it.
 * ---------------------------------------------------------------------------------------------- */

/**
 * The taxonomy branch that holds bags, boxes, lids, cutlery and labels.
 *
 * Packaging lives in `ingredients` because a recipe has to be able to cost the
 * box its meal ships in, and a cost line needs a record to point at. It is not
 * a *raw material* though, so every surface that means "food" excludes this
 * branch and the one surface that means "packaging" asks for it by name. One
 * constant rather than the string in six places, because the day it is
 * mistyped in one of them the ingredient list silently grows 31 rows of
 * cutlery and nothing fails.
 */
export const PACKAGING_CATEGORY_CODE = 'packaging-disposables';

/**
 * Branches of the ingredient taxonomy that hold no raw materials — only finished goods.
 *
 * The v6 import writes an ingredient beside every sellable row it brings in, because a sauce is
 * both sold and consumed and a formulation has to be able to name it: 43 `SAC-` sauces, 19 `DRS-`
 * dressings, and the `PRD-`/`RSL-` product and resale lines. Those rows are filed under Sauce,
 * Dressings, Beverage and Bread, and **nothing numbered `ING-` is**.
 *
 * The ingredient list keeps only the `ING-` series (`IngredientIndexController::applySeries`), so
 * these four can never return a row there. They are not junk data and they are not deletable — the
 * sauces and dressings screens are built on the rows filed under them — they simply do not belong
 * in a picker whose subject is raw materials.
 *
 * Two surfaces read this, and they have to agree: the list's category filter hides them because a
 * choice that can only ever produce an empty page is worse than no choice, and the ingredient
 * editor hides them so a new raw material cannot be filed somewhere the list that created it would
 * never show it. The second is what keeps the first true.
 *
 * Not applied to the recipe line picker, which serves a cook writing a burger who has every reason
 * to reach for Garlic Mayo Sauce.
 */
export const PRODUCT_FAMILY_CATEGORY_CODES: readonly string[] = [
    'sauce',
    'dressings',
    'beverage',
    'bread',
];

export interface IngredientAdminFilter extends CursorPageRequest, OffsetPageRequest {
    readonly query?: string | undefined;
    readonly statuses?: readonly PublishableStatus[] | undefined;
    readonly categoryCode?: string | undefined;
    /**
     * Drops a whole branch, subcategories included. The mirror of
     * {@link categoryCode}, and the two are usually used as a pair by two
     * screens reading the same collection from opposite ends — the ingredient
     * list excluding {@link PACKAGING_CATEGORY_CODE}, the packaging list
     * asking for it.
     */
    readonly excludeCategoryCode?: string | undefined;
    /**
     * Keeps only the rows numbered in one series. The ingredient list asks for `ING-`.
     *
     * A whitelist, because everything else in that table earned its place there another way: the
     * import writes a `SAC-`/`DRS-`/`RSL-` ingredient beside every sellable row so a formulation
     * can name it, and packaging carries `PKG-`. None are raw materials. Filing cannot separate
     * them — the resale twins sit in the same categories as real food — and deleting them cannot
     * either, because the next import writes them back. The series survives both.
     *
     * The browse list passes it; the recipe line picker does not, because a burger has every reason
     * to name Garlic Mayo Sauce as a line.
     */
    readonly referenceSeries?: IngredientReferenceSeries | undefined;
    readonly allergenCodes?: readonly AllergenCode[] | undefined;
    /** Only rows this organisation owns; omit for the library plus the kitchen's own forks. */
    readonly ownedOnly?: boolean | undefined;
}

/**
 * The two series the ingredient table is numbered in.
 *
 * Narrower than {@link ReferenceSeries}: `RC-`, `SAC-` and `DRS-` are recipe and catalogue handles,
 * and asking this list for one would be asking for rows it is written to leave out.
 */
export type IngredientReferenceSeries = 'ING-' | 'PKG-';

export interface CreateIngredientRequest {
    readonly name: LocalisedText;
    readonly categoryCode: string;
    /** Must be a child of `categoryCode`; the server refuses a leaf from another branch. */
    readonly subcategoryCode?: string | undefined;
    readonly measurementUnit: MeasureUnit;
    readonly purchaseUnit?: MeasureUnit | undefined;
    readonly composition?: string | undefined;
    readonly itemsPerUnit?: number | undefined;
    readonly b2bPrice?: CostAmount | undefined;
    readonly b2cPrice?: CostAmount | undefined;
    readonly unitPrice?: CostAmount | undefined;
    readonly isSellable?: boolean | undefined;
    readonly reference?: string | undefined;
    readonly costPer100g?: CostAmount | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
    readonly aliases?: readonly string[] | undefined;
    readonly notes?: string | undefined;
}

export interface UpdateIngredientRequest extends LockedRequest {
    readonly name?: LocalisedText | undefined;
    readonly categoryCode?: string | undefined;
    /** `null` files the ingredient at the top level. Must be a child of the effective category. */
    readonly subcategoryCode?: string | null | undefined;
    readonly measurementUnit?: MeasureUnit | undefined;
    readonly purchaseUnit?: MeasureUnit | null | undefined;
    readonly composition?: string | null | undefined;
    readonly itemsPerUnit?: number | null | undefined;
    /** `null` clears the price. Both prices share one currency. */
    readonly b2bPrice?: CostAmount | null | undefined;
    /** `null` clears the price. Both prices share one currency. */
    readonly b2cPrice?: CostAmount | null | undefined;
    /** `null` clears it. Shares the same currency as the two list prices. */
    readonly unitPrice?: CostAmount | null | undefined;
    /** No null state: the column defaults to false, so omit the field to leave it alone. */
    readonly isSellable?: boolean | undefined;
    /** Per-100 g reference facts; `null` clears them. */
    readonly per100g?: NutritionFacts | null | undefined;
    readonly reference?: string | null | undefined;
    readonly costPer100g?: CostAmount | null | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
    readonly aliases?: readonly string[] | undefined;
    readonly notes?: string | null | undefined;
}

/**
 * The whole mapping set, replaced at once.
 *
 * Wholesale rather than per-mapping add/remove because an allergen determination is judged as a
 * set: "contains milk, may contain nuts, verified by the supplier on this date" is one decision,
 * and applying half of it would leave a label that nobody meant to publish.
 */
export interface SetIngredientAllergensRequest extends LockedRequest {
    readonly mappings: readonly IngredientAllergenMapping[];
}

/* ------------------------------------------------------------------------------------------------
 * Recipes, versions, lines and outputs
 * ---------------------------------------------------------------------------------------------- */

/** One raw-material line of a recipe version. `lineCost` is confidential. */
/**
 * How a packaging line works out how many it needs.
 *
 * The three are genuinely different arithmetic, not three labels for one sum, which is why the
 * server returns the stored rows rather than echoing the request: two of them compute their own
 * quantity, so what comes back is not what went in.
 *
 * - `fills_yield` — the batch is divided into these. One 0.3 kg bottle for a 1.7 kg yield is six
 *   bottles, and the count moves when the yield does.
 * - `per_container` — one per container already counted by another line. A lid for each bottle.
 * - `per_batch` — a flat count however big the batch is. One label on the tray.
 */
export const PACKAGING_BASES = ['fills_yield', 'per_container', 'per_batch'] as const;
export type PackagingBasis = (typeof PACKAGING_BASES)[number];

/** One packaging line on a recipe version. */
export interface RecipePackagingLine {
    readonly ingredientId: IngredientId;
    readonly basis: PackagingBasis;
    /**
     * The count. Server-computed for `fills_yield` and `per_container`, which is why this is read
     * back rather than trusted from the draft.
     */
    readonly quantity: number;
    readonly unit: MeasureUnit;
    readonly comment: string | null;
}

/** One packaging line as a write states it. `quantity` is ignored for the computed bases. */
export interface RecipePackagingLineInput {
    readonly ingredientId: IngredientId;
    readonly basis: PackagingBasis;
    readonly quantity?: number | undefined;
    readonly comment?: string | undefined;
}

/**
 * Replaces the whole packaging set on a version.
 *
 * Wholesale like {@link SetRecipeLinesRequest}, and for the same reason: the set is the unit of
 * change, so "I removed the sleeve" and "I forgot to send the sleeve" have to stay different
 * requests. `lockVersion` is the *version's*, not a line's.
 */
export interface SetRecipePackagingRequest extends LockedRequest {
    readonly packaging: readonly RecipePackagingLineInput[];
}

export interface RecipeLine {
    readonly ingredientId: IngredientId;
    readonly ingredientName: LocalisedText;
    readonly quantity: number;
    readonly unit: MeasureUnit;
    /**
     * The designation as written on the kitchen's own sheet, kept verbatim beside the resolved
     * ingredient. An import that silently normalised "Chuck" to "Beef, chuck" would destroy the
     * only evidence of what the sheet actually said.
     */
    readonly sourceDesignation: string | null;
    readonly isOptional: boolean;
    /** CONFIDENTIAL — the cost of this quantity at the ingredient's recorded cost. */
    readonly lineCost: CostAmount | null;
}

/**
 * What a version *produces* (plan §4.2).
 *
 * This replaces the earlier `ingredients.produced_by_recipe_id` design outright. An intermediate —
 * a pesto mix, a demi-glace — is simply an ingredient that appears in some version's outputs; an
 * ingredient with no output row anywhere is bought rather than made, and needs no stub recipe
 * invented for it. One output per version may be primary.
 */
export interface RecipeOutput {
    readonly ingredientId: IngredientId;
    readonly ingredientName: LocalisedText;
    readonly quantity: number;
    readonly unit: MeasureUnit;
    readonly isPrimary: boolean;
}

export interface RecipeStepAdmin {
    /** 1-based, and contiguous: the editor renumbers rather than leaving gaps. */
    readonly index: number;
    readonly instruction: LocalisedText;
    readonly minutes: number | null;
}

/** Where a version's allergen label came from. */
export const ALLERGEN_DECLARATION_ORIGINS = ['declared', 'derived'] as const;
export type AllergenDeclarationOrigin = (typeof ALLERGEN_DECLARATION_ORIGINS)[number];

export interface RecipeAllergenDeclaration {
    readonly allergenCode: AllergenCode;
    readonly containment: AllergenContainment;
    readonly origin: AllergenDeclarationOrigin;
    /** The lines that put it there. Empty for a `declared` entry a person added by hand. */
    readonly sourceIngredientIds: readonly IngredientId[];
}

export interface RecipeVersionSummary {
    readonly id: RecipeVersionId;
    readonly versionNumber: number;
    readonly status: PublishableStatus;
    readonly publishedAt: IsoDateTime | null;
    readonly updatedAt: IsoDateTime;
    readonly isCurrent: boolean;
}

/**
 * One version of a recipe, with everything a technical sheet shows.
 *
 * **A published version is immutable.** Editing a published recipe does not change it: the server
 * opens a new `draft` version from it and the edit lands there (plan §4.7). That is why every
 * line/step/output setter here returns the whole {@link RecipeAdmin} — the caller's idea of which
 * version it was editing may have just been superseded, and hiding that would produce an editor
 * silently writing into a version nobody is looking at.
 */
export interface RecipeVersionAdmin {
    readonly id: RecipeVersionId;
    readonly recipeId: RecipeId;
    readonly versionNumber: number;
    readonly status: PublishableStatus;
    /** How much the version makes, in `yieldUnit`. */
    readonly yieldQuantity: number;
    readonly yieldUnit: MeasureUnit;
    /** Pieces produced, when the yield is countable as well as weighable. */
    readonly yieldPieces: number | null;
    /** Process loss, whole percent. The source sheets state 3 %. */
    readonly wastePercent: number;
    /**
     * Trade list price for one unit of `yieldUnit`, `null` when none is recorded.
     *
     * A list price, not a cost: what this version is offered at to a kitchen or corporate buyer,
     * rather than what its inputs cost to make (`estimatedCost`, which moves with every receipt
     * behind it) or what a channel charges on a date (a price list). It is the numerator of the
     * gross margin the editor reads back, and `estimatedCost` per yield unit is the denominator.
     *
     * On the version rather than the recipe: publishing freezes a version, and a price on the
     * recipe would let a later reprice silently restate what a published version was sold for.
     * Opening the next draft carries both figures forward.
     */
    readonly b2bPrice: CostAmount | null;
    /** Consumer list price for one unit of `yieldUnit`; the counterpart to `b2bPrice`. */
    readonly b2cPrice: CostAmount | null;
    readonly lines: readonly RecipeLine[];
    readonly packaging: readonly RecipePackagingLine[];
    readonly outputs: readonly RecipeOutput[];
    readonly steps: readonly RecipeStepAdmin[];
    readonly allergens: readonly RecipeAllergenDeclaration[];
    /** CONFIDENTIAL — the summed line costs. `null` while any line has no recorded cost. */
    readonly estimatedCost: CostAmount | null;
    /** True when a line or an ingredient changed after the figures were last derived. */
    readonly derivationStale: boolean;
    readonly publishedAt: IsoDateTime | null;
}

export interface RecipeAdminSummary {
    readonly id: RecipeId;
    readonly meta: AdminEntityMeta;
    readonly name: LocalisedText;
    readonly slug: string;
    /**
     * The kitchen's own sequential handle — `RC-0001`, the recipe counterpart of an ingredient's
     * `ING-002`. Assigned on create and stable for the life of the record. `null` only on rows that
     * predate the series.
     */
    readonly reference: string | null;
    readonly kitchenId: KitchenId;
    /** The source sheet's own Kind wording ("Production", "Preparation"), verbatim. */
    readonly sourceKind: string | null;
    /**
     * How the kitchen files this formulation within its family — `cooking_sauce`, `marinade_prep`.
     *
     * Free text with a length bound and no enumeration, and deliberately so: the column carries no
     * CHECK constraint because a kitchen's own filing words are not a vocabulary a schema gets to
     * fix. The sauce and dressing routes offer the four the v6 sheets use; anything already in the
     * column survives being read and written back.
     */
    readonly recipeCategory: string | null;
    readonly currentVersionNumber: number;
    readonly versionCount: number;
}

export interface RecipeAdmin extends RecipeAdminSummary {
    readonly description: LocalisedText;
    readonly currentVersion: RecipeVersionAdmin;
    /** Newest first. Summaries only — a version's lines are fetched by opening it. */
    readonly versions: readonly RecipeVersionSummary[];
}

export interface RecipeAdminFilter extends CursorPageRequest, OffsetPageRequest {
    readonly query?: string | undefined;
    readonly statuses?: readonly PublishableStatus[] | undefined;
    readonly kitchenId?: KitchenId | undefined;
    /**
     * Narrows to the rows whose allergen label carries one of these classes.
     *
     * The endpoint takes a single class, because that is the question a list column asks — its
     * menu is single-select. A caller passing several is asking for a union no endpoint here
     * expresses, and gets the first one rather than a silently page-local pass: a filter that
     * narrowed the loaded page would leave the count and every page after it describing the
     * unfiltered set.
     */
    readonly allergenCodes?: readonly AllergenCode[] | undefined;
    /** Only recipes whose current version needs re-derivation. */
    readonly staleOnly?: boolean | undefined;
}

/**
 * CONFIDENTIAL — one costed line of the technical sheet, in the same order as
 * {@link RecipeVersionAdmin.lines}; a client renders designation, quantity and
 * unit from the version line and the money from here.
 */
export interface TechnicalSheetLineAdmin {
    readonly lineNumber: number;
    readonly ingredientId: IngredientId;
    /** CONFIDENTIAL — the sheet's U.P. column: cost of one usage unit. */
    readonly unitCost: CostAmount | null;
    /** CONFIDENTIAL — the sheet's T column, verbatim even where its arithmetic is wrong. */
    readonly lineCost: CostAmount | null;
    readonly comment: string | null;
}

/** CONFIDENTIAL — one basis of the sheet's cost block. */
export interface RecipeCostFigures {
    readonly totalInputCost: CostAmount;
    /** Total ÷ yield quantity, when the version states one. */
    readonly costPerYieldUnit: CostAmount | null;
    readonly costPerYieldUnitWithWaste: CostAmount | null;
    /** Total ÷ piece count, when the version counts pieces. */
    readonly costPerPiece: CostAmount | null;
    readonly costPerPieceWithWaste: CostAmount | null;
    readonly wastePercent: number;
    /** The sheet's own label claims a basis the yield cannot support. */
    readonly basisMismatch: boolean;
    readonly calculatedAt: IsoDateTime;
}

/**
 * CONFIDENTIAL — the technical sheet of one recipe version: the costed lines
 * and the latest snapshot per basis. `null` from the repository means the
 * caller lacks `recipe.view_costs_organisation`; a sheet with no costed lines
 * still arrives, with empty money.
 */
export interface TechnicalSheetAdmin {
    readonly versionId: RecipeVersionId;
    readonly currency: CurrencyCode | null;
    readonly currencyConflict: boolean;
    readonly lines: readonly TechnicalSheetLineAdmin[];
    readonly uncostedLineNumbers: readonly number[];
    /** The sheet's own figures, verbatim (`as_recorded`). */
    readonly asRecorded: RecipeCostFigures | null;
    /** This system's arithmetic over the same lines (`recalculated`). */
    readonly recalculated: RecipeCostFigures | null;
}

/**
 * The reference series a record is numbered in.
 *
 * `ING-` is the ingredient library's. The other three are the recipe table's: the library, sauces
 * and dressings are all recipes, read off different sheets and quoted by different handles, so they
 * number separately. A client names the series; the number in it is always the server's.
 */
export type ReferenceSeries = 'ING-' | 'RC-' | 'SAC-' | 'DRS-';

/*
 * Where each series is counted, which is the table its existing handles are in: `ING-` among the
 * ingredients, `RC-` among the recipes, `SAC-` and `DRS-` among the catalogue items — the import
 * wrote forty-three sauces and nineteen dressings there, and on the ingredient twin it writes
 * beside each one. A series counted anywhere else would offer a handle a kitchen already has.
 */

export interface CreateRecipeRequest {
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    /** See {@link RecipeAdminSummary.recipeCategory}. Omitted leaves it unfiled. */
    readonly recipeCategory?: string | undefined;
    readonly yieldQuantity: number;
    readonly yieldUnit: MeasureUnit;
    readonly yieldPieces?: number | undefined;
    readonly wastePercent?: number | undefined;
    /** Trade list price per yield unit. Omitted leaves it unpriced. */
    readonly b2bPrice?: CostAmount | undefined;
    readonly b2cPrice?: CostAmount | undefined;
}

export interface UpdateRecipeRequest extends LockedRequest {
    readonly name?: LocalisedText | undefined;
    readonly description?: LocalisedText | undefined;
    /** See {@link RecipeAdminSummary.recipeCategory}. `null` clears it. */
    readonly recipeCategory?: string | null | undefined;
    readonly yieldQuantity?: number | undefined;
    readonly yieldUnit?: MeasureUnit | undefined;
    readonly yieldPieces?: number | null | undefined;
    readonly wastePercent?: number | undefined;
    /**
     * Trade list price per yield unit. `null` **clears** it, `undefined` leaves it alone — the same
     * three-way distinction the ingredient editor's prices draw, and the reason an emptied price box
     * removes a price rather than being read as "no opinion".
     */
    readonly b2bPrice?: CostAmount | null | undefined;
    readonly b2cPrice?: CostAmount | null | undefined;
}

/** A line as a caller writes it. Costs and names are derived server-side, never client-supplied. */
export interface RecipeLineInput {
    readonly ingredientId: IngredientId;
    readonly quantity: number;
    readonly unit: MeasureUnit;
    readonly sourceDesignation?: string | undefined;
    readonly isOptional?: boolean | undefined;
}

export interface SetRecipeLinesRequest extends LockedRequest {
    readonly lines: readonly RecipeLineInput[];
}

export interface RecipeStepInput {
    readonly instruction: LocalisedText;
    readonly minutes?: number | null | undefined;
}

export interface SetRecipeStepsRequest extends LockedRequest {
    /** Order in the array *is* the step order; the server assigns `index`. */
    readonly steps: readonly RecipeStepInput[];
}

export interface RecipeOutputInput {
    readonly ingredientId: IngredientId;
    readonly quantity: number;
    readonly unit: MeasureUnit;
    readonly isPrimary?: boolean | undefined;
}

export interface SetRecipeOutputsRequest extends LockedRequest {
    /** At most one may be primary; the server rejects a second with `validation.failed`. */
    readonly outputs: readonly RecipeOutputInput[];
}

/* ── the roll-up preview ─────────────────────────────────────────────────────────────────────── */

/**
 * The lines a caller wants figures for, before any of them is saved.
 *
 * A **query over a proposal**: it stores nothing, changes nothing, and can be called on every
 * keystroke of a line editor (debounced). `recipeId` is `null` while a brand-new recipe is being
 * composed, which is exactly when the preview is most useful.
 */
export interface RecipeRollupDraft {
    readonly recipeId: RecipeId | null;
    readonly servings: number;
    readonly serving?: Serving | undefined;
    readonly wastePercent?: number | undefined;
    readonly lines: readonly RecipeLineInput[];
}

/** One allergen the draft would declare, and the lines that put it there. */
export interface AllergenSource {
    readonly allergenCode: AllergenCode;
    readonly containment: AllergenContainment;
    /** Every line responsible, so the editor can point at them rather than just naming the code. */
    readonly ingredientIds: readonly IngredientId[];
}

/** Something the roll-up could not do honestly. Never a silent zero. */
export interface RollupWarning {
    /** Stable code the UI translates, e.g. `rollup.missing_facts`. */
    readonly code: string;
    /** Server-authored sentence, used when the UI has no copy for the code yet. */
    readonly message: string;
    readonly ingredientIds: readonly IngredientId[];
}

export interface RecipeRollupPreview {
    readonly perRecipe: NutritionFacts;
    readonly perServing: NutritionFacts;
    /** `null` when the total mass is unknown, so a per-100 g comparison would be a guess. */
    readonly per100g: NutritionFacts | null;
    readonly allergenSources: readonly AllergenSource[];
    /** CONFIDENTIAL — summed line costs. `null` when any line has no recorded cost. */
    readonly estimatedCost: CostAmount | null;
    readonly warnings: readonly RollupWarning[];
}

/* ------------------------------------------------------------------------------------------------
 * Products
 * ---------------------------------------------------------------------------------------------- */

/** A pack a product is sold in. `code` is stable within the product and is what a price points at. */
export interface ProductPackVariant {
    readonly code: string;
    readonly label: LocalisedText;
    readonly netQuantity: number;
    readonly netUnit: MeasureUnit;
    /** Units inside the pack — a tray of twelve is `12`, a single bottle is `1`. */
    readonly unitsPerPack: number;
}

export interface ProductAdmin {
    readonly id: ProductId;
    readonly meta: AdminEntityMeta;
    /**
     * Which packaged kind this row is. Sauces and dressings share the product
     * shape wholesale — same packs, same pricing, same publication — and the
     * kitchen screens list each kind on its own page via
     * {@link ProductAdminFilter.itemType}.
     */
    readonly itemType: 'product' | 'sauce' | 'dressing';
    /**
     * The kitchen's own handle — `SAC-001`, `DRS-019`, `RSL-055`.
     *
     * The v6 sheets number every row they publish, and the number is how a kitchen quotes one on a
     * phone. It comes from `source_ref`, the same column the ingredient library's `ING-002` lives
     * in; `null` on a row that predates the series or was typed in before one was assigned.
     */
    readonly reference: string | null;
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    /**
     * The category's id, which is what `/catalogue/items` filters by.
     *
     * Carried beside the code rather than instead of it: the code is what a reader sees and what
     * the row groups by, the id is what the request needs, and a screen holding only one of the two
     * has to guess at the other. `null` on a row the catalogue never filed.
     */
    readonly categoryId: string | null;
    readonly categoryCode: string;
    /** The kitchen's own nested filing pair, transcribed from its sheets. */
    readonly kitchenCategory: string | null;
    readonly kitchenSubcategory: string | null;
    /** Coarse "Made From" transcription, kitchen-facing. */
    readonly composition: string | null;
    readonly kitchenId: KitchenId;
    /** True for goods priced at the day's market rate; such a product carries no confirmed price. */
    readonly isMarketPriced: boolean;
    /** True for a row that stands for a mixed selection rather than one article. */
    readonly isAssorted: boolean;
    readonly packVariants: readonly ProductPackVariant[];
    readonly channelAvailability: readonly ChannelAvailability[];
    /** The recipe it is produced from, when it is produced rather than bought in. */
    readonly recipeId: RecipeId | null;
    readonly dietClassifications: readonly DietClassification[];
    /** Import findings the operator has not resolved, e.g. `dual_pack_single_price`. */
    readonly dataQualityFlags: readonly string[];
}

export interface ProductAdminFilter extends CursorPageRequest, OffsetPageRequest {
    readonly query?: string | undefined;
    readonly statuses?: readonly PublishableStatus[] | undefined;
    readonly categoryCode?: string | undefined;
    /**
     * The category the endpoint narrows by, as its id.
     *
     * `product_category_id` is what `/catalogue/items` takes, and it is an id rather than a code -
     * so a screen that knows only the code cannot ask the server, which is why this list filtered
     * the loaded page for a long time and reported a count for the whole collection while doing it.
     * The id travels on the row (`ProductAdmin.categoryId`), so the picker builds its values and
     * their ids from the same read.
     */
    readonly categoryId?: string | undefined;
    readonly channels?: readonly SalesChannel[] | undefined;
    /** Which packaged kind to list. Defaults to `product`. */
    readonly itemType?: 'product' | 'sauce' | 'dressing' | undefined;
}

export interface CreateProductRequest {
    /** Defaults to `product`; the sauces and dressings screens pass their own. */
    readonly itemType?: 'product' | 'sauce' | 'dressing' | undefined;
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    readonly categoryCode: string;
    readonly recipeId?: RecipeId | undefined;
    readonly isMarketPriced?: boolean | undefined;
    readonly isAssorted?: boolean | undefined;
    readonly packVariants?: readonly ProductPackVariant[] | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
}

export interface UpdateProductRequest extends LockedRequest {
    readonly name?: LocalisedText | undefined;
    readonly description?: LocalisedText | undefined;
    readonly categoryCode?: string | undefined;
    readonly recipeId?: RecipeId | null | undefined;
    readonly isMarketPriced?: boolean | undefined;
    readonly isAssorted?: boolean | undefined;
    readonly packVariants?: readonly ProductPackVariant[] | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
}

export interface SetChannelAvailabilityRequest extends LockedRequest {
    readonly availability: readonly ChannelAvailability[];
}

/* ------------------------------------------------------------------------------------------------
 * Price lists
 * ---------------------------------------------------------------------------------------------- */

/**
 * Why a price is what it is.
 *
 * `placeholder` exists because the source material has plans with no numbers at all, and the
 * programme's rule is that a fabricated price never reaches a public surface (plan §2.4). A
 * placeholder entry carries `amountMinor: null` and is excluded from every consumer projection.
 * `market_priced` is the same absence for a different reason: the price is the day's market rate.
 */
export const PRICE_STATUSES = ['confirmed', 'placeholder', 'market_priced'] as const;
export type PriceStatus = (typeof PRICE_STATUSES)[number];

export interface PriceListEntry {
    readonly item: CatalogueItemRef;
    readonly priceStatus: PriceStatus;
    /**
     * Minor units of the list's currency — prices stay integers (plan §4.4). `null` unless the
     * status is `confirmed`; see {@link isPriceEntryConsistent}.
     */
    readonly amountMinor: number | null;
    /** `YYYY-MM-DD`. Effective-dated: a new entry supersedes rather than overwrites. */
    readonly effectiveFrom: string;
    readonly effectiveUntil: string | null;
    readonly note: string | null;
}

/**
 * The `CHECK` the migration enforces, expressed once so the mock, the editor and the future mapper
 * cannot disagree about it: **a confirmed price has an amount, and nothing else does.**
 */
export function isPriceEntryConsistent(entry: PriceListEntry): boolean {
    return entry.priceStatus === 'confirmed'
        ? entry.amountMinor !== null
        : entry.amountMinor === null;
}

export interface PriceListAdmin {
    readonly id: PriceListId;
    readonly meta: AdminEntityMeta;
    readonly name: LocalisedText;
    /** One currency per list; no entry may quote another (plan §4.4). */
    readonly currency: CurrencyCode;
    readonly kitchenId: KitchenId;
    /** Channels the list applies to. A B2B list never reaches a consumer surface. */
    readonly channels: readonly SalesChannel[];
    readonly entries: readonly PriceListEntry[];
}

export interface PriceListAdminFilter extends CursorPageRequest, OffsetPageRequest {
    readonly query?: string | undefined;
    readonly statuses?: readonly PublishableStatus[] | undefined;
    readonly channels?: readonly SalesChannel[] | undefined;
    readonly currency?: CurrencyCode | undefined;
}

export interface SetPriceListEntriesRequest extends LockedRequest {
    readonly entries: readonly PriceListEntry[];
}

/* ------------------------------------------------------------------------------------------------
 * Meals
 * ---------------------------------------------------------------------------------------------- */

export interface MealAvailabilityDay {
    /** `YYYY-MM-DD`. */
    readonly date: string;
    readonly isAvailable: boolean;
    /** Remaining portions, when the kitchen tracks them. `null` when it does not. */
    readonly remaining: number | null;
    /** `HH:mm`, branch-local. `null` inherits the branch's cut-off for that weekday. */
    readonly orderCutOffAt: string | null;
}

export interface MealAdmin {
    readonly id: MealId;
    readonly meta: AdminEntityMeta;
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    /** The kitchen's own nested filing pair, transcribed from its sheets. */
    readonly kitchenCategory: string | null;
    readonly kitchenSubcategory: string | null;
    /** Coarse "Made From" transcription, kitchen-facing. */
    readonly composition: string | null;
    readonly kitchenId: KitchenId;
    /** The recipe *version* the meal's figures were computed from. Both `null` for a bought-in meal. */
    readonly recipeId: RecipeId | null;
    readonly recipeVersionId: RecipeVersionId | null;
    /** The portion sold, relative to one recipe serving. */
    readonly portionFactor: number;
    readonly mealTypes: readonly MealType[];
    readonly dietClassifications: readonly DietClassification[];
    /** Frozen at publication from the recipe version's declaration; never edited here directly. */
    readonly allergens: readonly AllergenCode[];
    readonly channelAvailability: readonly ChannelAvailability[];
    readonly availability: readonly MealAvailabilityDay[];
    readonly imagePlaceholderId: string;
    /**
     * CONFIDENTIAL — gross margin against the recipe's cost per serving at the current confirmed
     * price, whole percent. `null` when either side of that sum is missing, which is honest: a
     * margin over a placeholder price is a fiction.
     */
    readonly marginPercent: number | null;
}

export interface MealAdminFilter extends CursorPageRequest, OffsetPageRequest {
    readonly query?: string | undefined;
    readonly statuses?: readonly PublishableStatus[] | undefined;
    readonly kitchenId?: KitchenId | undefined;
    readonly mealTypes?: readonly MealType[] | undefined;
    /**
     * Narrows to the rows whose allergen label carries one of these classes.
     *
     * The endpoint takes a single class, because that is the question a list column asks — its
     * menu is single-select. A caller passing several is asking for a union no endpoint here
     * expresses, and gets the first one rather than a silently page-local pass: a filter that
     * narrowed the loaded page would leave the count and every page after it describing the
     * unfiltered set.
     */
    readonly allergenCodes?: readonly AllergenCode[] | undefined;
    /** See `ProductAdminFilter.categoryId` — meals are catalogue items and take the same param. */
    readonly categoryId?: string | undefined;
}

export interface CreateMealRequest {
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    readonly recipeId?: RecipeId | undefined;
    readonly portionFactor?: number | undefined;
    readonly mealTypes?: readonly MealType[] | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
}

export interface UpdateMealRequest extends LockedRequest {
    readonly name?: LocalisedText | undefined;
    readonly description?: LocalisedText | undefined;
    readonly recipeId?: RecipeId | null | undefined;
    readonly portionFactor?: number | undefined;
    readonly mealTypes?: readonly MealType[] | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
}

export interface SetMealAvailabilityRequest extends LockedRequest {
    readonly days: readonly MealAvailabilityDay[];
}

/* ------------------------------------------------------------------------------------------------
 * Subscription plans
 * ---------------------------------------------------------------------------------------------- */

/**
 * How long a plan runs (plan §4.3).
 *
 * Replaces the consumer contract's `1w | 2w | 4w | 12w` union, which cannot represent the source
 * material's 5-, 20-, 40- and 60-day commitments, and replaces the earlier zero-day sentinel for a
 * single delivery. `one_off` carries no day count; `fixed_days` carries a positive one. The
 * database `CHECK` says exactly that, and so does {@link isPlanDurationConsistent}.
 */
export const PLAN_DURATION_KINDS = ['one_off', 'fixed_days'] as const;
export type PlanDurationKind = (typeof PLAN_DURATION_KINDS)[number];

export interface PlanDurationAdmin {
    readonly kind: PlanDurationKind;
    /** Whole days for `fixed_days`; `null` for `one_off`. */
    readonly days: number | null;
    /** Whole percent off, or `null` when no discount has been decided yet. Never `0` as a stand-in. */
    readonly discountPercent: number | null;
}

export function isPlanDurationConsistent(duration: PlanDurationAdmin): boolean {
    return duration.kind === 'one_off'
        ? duration.days === null
        : duration.days !== null && duration.days > 0;
}

export interface PlanVariantAdmin {
    readonly id: PlanVariantId;
    readonly name: LocalisedText;
    /** Advertised energy band, kcal per day. */
    readonly energyBand: { readonly min: number; readonly max: number };
    readonly mealsPerDay: number;
    readonly snacksPerDay: number;
    readonly isActive: boolean;
}

/**
 * A meal-combination option — the source material's "Standard / Premium × meals per day" matrix.
 *
 * Keyed by a kitchen-set `code` rather than an identifier: combinations are a small, hand-authored
 * matrix that is replaced wholesale, and an identifier per cell would be bookkeeping nobody reads.
 */
export interface PlanCombination {
    readonly code: string;
    readonly label: LocalisedText;
    readonly mealsPerDay: number;
    readonly snacksPerDay: number;
    readonly isAvailable: boolean;
}

export interface PlanAdmin {
    readonly id: SubscriptionPlanId;
    readonly meta: AdminEntityMeta;
    readonly name: LocalisedText;
    readonly summary: LocalisedText;
    readonly description: LocalisedText;
    readonly kitchenId: KitchenId;
    readonly categorySlugs: readonly string[];
    readonly dietClassifications: readonly DietClassification[];
    readonly variants: readonly PlanVariantAdmin[];
    readonly durations: readonly PlanDurationAdmin[];
    readonly combinations: readonly PlanCombination[];
    /** Hours before a delivery that a skip or a pause is still accepted. The source rule is 24. */
    readonly changeCutOffHours: number;
    /** Weekdays (1 Monday … 7 Sunday) the plan can be delivered on. */
    readonly deliveryWeekdays: readonly number[];
}

export interface PlanAdminFilter extends CursorPageRequest, OffsetPageRequest {
    readonly query?: string | undefined;
    readonly statuses?: readonly PublishableStatus[] | undefined;
    readonly kitchenId?: KitchenId | undefined;
}

export interface CreatePlanRequest {
    readonly name: LocalisedText;
    readonly summary: LocalisedText;
    readonly description: LocalisedText;
    readonly categorySlugs?: readonly string[] | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
    readonly changeCutOffHours?: number | undefined;
    readonly deliveryWeekdays?: readonly number[] | undefined;
}

export interface UpdatePlanRequest extends LockedRequest {
    readonly name?: LocalisedText | undefined;
    readonly summary?: LocalisedText | undefined;
    readonly description?: LocalisedText | undefined;
    readonly categorySlugs?: readonly string[] | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
    readonly changeCutOffHours?: number | undefined;
    readonly deliveryWeekdays?: readonly number[] | undefined;
}

/** A variant as a caller writes it. `id` is `null` for one being added. */
export interface PlanVariantInput {
    readonly id: PlanVariantId | null;
    readonly name: LocalisedText;
    readonly energyBand: { readonly min: number; readonly max: number };
    readonly mealsPerDay: number;
    readonly snacksPerDay: number;
    readonly isActive?: boolean | undefined;
}

export interface SetPlanVariantsRequest extends LockedRequest {
    readonly variants: readonly PlanVariantInput[];
}

export interface SetPlanDurationsRequest extends LockedRequest {
    readonly durations: readonly PlanDurationAdmin[];
}

export interface SetPlanCombinationsRequest extends LockedRequest {
    readonly combinations: readonly PlanCombination[];
}

/* ------------------------------------------------------------------------------------------------
 * The fixed menu
 * ---------------------------------------------------------------------------------------------- */

/**
 * The four sittings a dish can fill.
 *
 * Exactly the vocabulary `subscription_meal_choices.slot` stores, because generation copies this
 * string straight onto a choice row: a value a menu admitted and a choice did not would be a failure
 * discovered at the far end of the system, on the night the order was generated.
 */
export const PLAN_MENU_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type PlanMenuSlot = (typeof PLAN_MENU_SLOTS)[number];

/** One dish, in one slot, on one day of the plan's cycle. */
export interface PlanMenuEntry {
    /**
     * The server's row identifier.
     *
     * Carried so an editor can key a row that came from the server, and for nothing else: the
     * replacement body has **no identifier field**, because an entry's identity on this contract is
     * its coordinate — `(cycleDay, slot, sequence)` — and a menu is replaced as a whole document.
     */
    readonly id: string;
    /**
     * 1-based day of the cycle. **Day 1 is the anchor date itself**, and the cycle is anchored to the
     * *plan* rather than to each subscriber: everybody on the plan eats the same dish on the same
     * date, which is what makes a day one production run instead of an à la carte service.
     */
    readonly cycleDay: number;
    readonly slot: PlanMenuSlot;
    /** Disambiguates the kitchen that serves lunch twice. 1 unless somebody says otherwise. */
    readonly sequence: number;
    readonly mealId: MealId;
    /** As the server resolved it, so a menu renders without a second read per dish. */
    readonly mealName: LocalisedText;
}

/**
 * A plan's fixed menu, as one document.
 *
 * **All three parts move together.** A cycle length with no entries, entries with no cycle length,
 * and a cycle length with no anchor are each refused; all three empty is the legitimate statement
 * "this plan has no published menu", which is what every plan says until somebody writes one.
 *
 * Publishing a menu is a **cutover**, not a cosmetic change: until one exists a fixed-menu
 * subscription order carries no meal lines and deducts no stock, and from the first save generation
 * fills the day's choices from this menu and confirmed orders start consuming ingredients.
 */
export interface PlanMenu {
    readonly planId: SubscriptionPlanId;
    /**
     * The **catalogue item's** meta, not the profile's.
     *
     * `subscription_plan_profiles` is not lock-versioned: the menu write carries the item's version,
     * exactly as the profile write does, so a save reads this rather than inventing a number.
     */
    readonly meta: AdminEntityMeta;
    /** Length of the rotation in days, or `null` when no menu is published. */
    readonly cycleDays: number | null;
    /** `YYYY-MM-DD` the cycle's day 1 falls on. A date, because a cycle turns over at midnight. */
    readonly anchorDate: string | null;
    readonly entries: readonly PlanMenuEntry[];
}

/** One entry as the replacement body carries it — a coordinate and the dish that fills it. */
export interface PlanMenuEntryInput {
    readonly cycleDay: number;
    readonly slot: PlanMenuSlot;
    readonly sequence: number;
    /** Must be a **published meal** of this kitchen; anything else is refused with `422`. */
    readonly mealId: MealId;
}

/**
 * Replaces the whole menu.
 *
 * Replace, never merge, for {@link SetPlanVariantsRequest}'s reason and one more: an entry has no
 * stable identifier to merge against, so a partial write could not express "day 3's lunch is now a
 * different dish" without inventing one.
 */
export interface ReplacePlanMenuRequest extends LockedRequest {
    readonly entries: readonly PlanMenuEntryInput[];
    readonly cycleDays: number | null;
    readonly anchorDate: string | null;
}

/* ------------------------------------------------------------------------------------------------
 * Delivery zones, windows and branch operating data
 * ---------------------------------------------------------------------------------------------- */

export interface DeliveryWindow {
    readonly id: DeliveryWindowId;
    readonly label: LocalisedText;
    /**
     * ISO weekdays the window runs on, 1 Monday … 7 Sunday.
     *
     * A list rather than one row per day: "Morning, 08:00–11:00, Monday to Friday" is one rule a
     * person maintains, and splitting it into five rows makes an inconsistent Wednesday possible.
     */
    readonly weekdays: readonly number[];
    /** `HH:mm`, branch-local. */
    readonly startsAt: string;
    readonly endsAt: string;
    /** Deliveries the window can take, when the kitchen caps it. `null` for uncapped. */
    readonly capacity: number | null;
    readonly isActive: boolean;
}

export interface DeliveryZoneAdmin {
    readonly id: DeliveryZoneId;
    readonly meta: AdminEntityMeta;
    readonly name: LocalisedText;
    readonly kitchenId: KitchenId;
    /** Branches that serve the zone. */
    readonly branchIds: readonly KitchenBranchId[];
    /** Gazetteer rows the zone covers — resolved, so a screen need not fetch them separately. */
    readonly areas: readonly ServiceArea[];
    readonly deliveryFeeMinor: number | null;
    readonly minimumOrderMinor: number | null;
    readonly currency: CurrencyCode;
    readonly estimatedMinutes: number | null;
    readonly deliveryWindows: readonly DeliveryWindow[];
}

export interface DeliveryZoneAdminFilter extends CursorPageRequest, OffsetPageRequest {
    readonly query?: string | undefined;
    readonly statuses?: readonly PublishableStatus[] | undefined;
    readonly branchId?: KitchenBranchId | undefined;
}

export interface CreateDeliveryZoneRequest {
    readonly name: LocalisedText;
    readonly currency: CurrencyCode;
    readonly branchIds?: readonly KitchenBranchId[] | undefined;
    readonly deliveryFeeMinor?: number | null | undefined;
    readonly minimumOrderMinor?: number | null | undefined;
    readonly estimatedMinutes?: number | null | undefined;
}

export interface UpdateDeliveryZoneRequest extends LockedRequest {
    readonly name?: LocalisedText | undefined;
    readonly branchIds?: readonly KitchenBranchId[] | undefined;
    readonly deliveryFeeMinor?: number | null | undefined;
    readonly minimumOrderMinor?: number | null | undefined;
    readonly estimatedMinutes?: number | null | undefined;
}

export interface SetZoneAreasRequest extends LockedRequest {
    readonly serviceAreaIds: readonly ServiceAreaId[];
}

/** A window as a caller writes it. `id` is `null` for one being added. */
export interface DeliveryWindowInput {
    readonly id: DeliveryWindowId | null;
    readonly label: LocalisedText;
    readonly weekdays: readonly number[];
    readonly startsAt: string;
    readonly endsAt: string;
    readonly capacity?: number | null | undefined;
    readonly isActive?: boolean | undefined;
}

export interface SetDeliveryWindowsRequest extends LockedRequest {
    readonly windows: readonly DeliveryWindowInput[];
}

/**
 * One weekday of a branch's trading pattern (K1.7 — the gap the architectural review exposed).
 *
 * **All three `null` means closed.** A closed day is a row, not an absent one: a week with four
 * rows leaves "is Friday closed, or has nobody filled it in?" unanswerable, and an order cut-off
 * is exactly the kind of rule that must not be inferred from silence.
 */
export interface BranchOperatingDay {
    /** ISO weekday, 1 Monday … 7 Sunday. Exactly seven rows, always. */
    readonly weekday: number;
    /** `HH:mm`, branch-local. */
    readonly opensAt: string | null;
    readonly closesAt: string | null;
    /** Last time a same-day order is accepted. */
    readonly orderCutOffAt: string | null;
}

/**
 * A branch's operating data.
 *
 * Carries {@link AdminRecordMeta} rather than {@link AdminEntityMeta}: opening hours are an
 * operational setting, not a publishable record, and giving them a `draft` state would invent a
 * lifecycle the branch does not have.
 */
export interface BranchOperating {
    readonly branchId: KitchenBranchId;
    readonly meta: AdminRecordMeta;
    /** IANA zone the times are read in, e.g. `Asia/Beirut`. */
    readonly timeZone: string;
    readonly days: readonly BranchOperatingDay[];
}

export interface SetBranchOperatingRequest extends LockedRequest {
    readonly timeZone?: string | undefined;
    /** All seven weekdays, or the server rejects with `validation.failed`. */
    readonly days: readonly BranchOperatingDay[];
}

/* ------------------------------------------------------------------------------------------------
 * The repository
 * ---------------------------------------------------------------------------------------------- */

/**
 * Everything the kitchen workspace can read and write.
 *
 * Organisation- and branch-scoped by the middleware chain: every method here is reached with an
 * organisation context, and a row belonging to another kitchen answers `resource.not_found` rather
 * than `authz.permission_denied` — a tenant must not be able to probe for the existence of another
 * tenant's rows.
 */
export interface KitchenAdminRepository {
    /* ── platform reference (read-only) ─────────────────────────────────────────────────────── */

    /**
     * The canonical allergen classes. Small, stable and regulatory, so it is not paginated and has
     * no writer: a kitchen maps onto these codes and never edits them (plan §4.6).
     */
    listAllergenClasses(): Promise<readonly AllergenClass[]>;

    /** The delivery-area gazetteer a zone selects from. Read-only for the same reason. */
    listServiceAreas(filter?: ServiceAreaFilter): Promise<CursorPage<ServiceArea>>;

    /* ── references ─────────────────────────────────────────────────────────────────────────── */

    /**
     * The handle the next record of a kind will take — `ING-307`, `SAC-0016`.
     *
     * A create form draws its reference before there is a record to read one from, and this is the
     * same scan the create itself performs, so the two agree. **A preview, never a reservation**:
     * two people opening a form at the same moment are both told `ING-307`, the first to save takes
     * it, and the second saves at 308. Nothing may treat this as the record's reference — that is
     * whatever the create answers with.
     */
    nextReference(prefix: ReferenceSeries): Promise<string>;

    /* ── ingredients ────────────────────────────────────────────────────────────────────────── */

    /**
     * The whole category tree, both levels, in one unpaginated answer.
     *
     * Unpaginated for the same reason as {@link listAllergenClasses}: it is a small controlled
     * vocabulary that two pickers and a filter all need in full before they can offer a single
     * choice, and a cursor over it would only mean the third page of leaves is missing from the
     * menu. Retired branches are included — see {@link IngredientCategoryAdmin.isActive}.
     */
    listIngredientCategories(): Promise<readonly IngredientCategoryAdmin[]>;

    listIngredients(filter?: IngredientAdminFilter): Promise<CursorPage<IngredientAdmin>>;
    getIngredient(ingredientId: IngredientId): Promise<IngredientAdmin>;
    createIngredient(request: CreateIngredientRequest): Promise<IngredientAdmin>;
    updateIngredient(
        ingredientId: IngredientId,
        request: UpdateIngredientRequest,
    ): Promise<IngredientAdmin>;
    /** Retires the row. Nothing is deleted: recipes and cost snapshots still point at it. */
    archiveIngredient(ingredientId: IngredientId, request: LockedRequest): Promise<IngredientAdmin>;
    /**
     * Copies a platform-library row into this kitchen so it can be edited, and
     * answers with the copy.
     *
     * The library is shared and read-only to a kitchen; this is how a kitchen
     * makes one row its own. The copy carries the parent's fields, its aliases
     * and **both allergen layers** — a fork is a new id, and allergen mappings
     * are keyed on that id, so a copy that skipped them would silently drop a
     * declared allergen.
     *
     * Safe to call twice: a kitchen that already forked the row gets the fork
     * it already has, not a second one. Recipes already built on the library
     * row keep pointing at the library row; the fork applies to new use.
     *
     * Takes no lock version — nothing is being changed, so there is nothing to
     * be stale against.
     */
    forkIngredient(ingredientId: IngredientId): Promise<IngredientAdmin>;
    setIngredientAllergens(
        ingredientId: IngredientId,
        request: SetIngredientAllergensRequest,
    ): Promise<IngredientAdmin>;

    /* ── recipes ────────────────────────────────────────────────────────────────────────────── */

    listRecipes(filter?: RecipeAdminFilter): Promise<CursorPage<RecipeAdminSummary>>;
    getRecipe(recipeId: RecipeId): Promise<RecipeAdmin>;
    /**
     * CONFIDENTIAL — the costed technical sheet of one version, or `null` when
     * this member lacks `recipe.view_costs_organisation`. The panel renders
     * the sheet without money in that case rather than failing the screen.
     */
    getRecipeTechnicalSheet(
        recipeId: RecipeId,
        versionId: RecipeVersionId,
    ): Promise<TechnicalSheetAdmin | null>;
    createRecipe(request: CreateRecipeRequest): Promise<RecipeAdmin>;
    /** Editing a published recipe opens a new draft version; the result says which one is current. */
    updateRecipe(recipeId: RecipeId, request: UpdateRecipeRequest): Promise<RecipeAdmin>;
    setRecipeLines(recipeId: RecipeId, request: SetRecipeLinesRequest): Promise<RecipeAdmin>;
    setRecipeSteps(recipeId: RecipeId, request: SetRecipeStepsRequest): Promise<RecipeAdmin>;
    /**
     * Replaces the packaging set. The costed view of it is the technical sheet, behind the costs
     * permission; this returns the stored rows with their computed quantities.
     */
    setRecipePackaging(
        recipeId: RecipeId,
        versionId: RecipeVersionId,
        request: SetRecipePackagingRequest,
    ): Promise<RecipeAdmin>;
    setRecipeOutputs(recipeId: RecipeId, request: SetRecipeOutputsRequest): Promise<RecipeAdmin>;
    /** A query over an unsaved draft. Stores nothing; safe to call while a person is typing. */
    previewRecipeRollup(draft: RecipeRollupDraft): Promise<RecipeRollupPreview>;
    /** Refused from `review_required` — a quarantined recipe cannot be published (plan §4.7). */
    publishRecipe(recipeId: RecipeId, request: LockedRequest): Promise<RecipeAdmin>;
    retireRecipe(recipeId: RecipeId, request: LockedRequest): Promise<RecipeAdmin>;

    /* ── products ───────────────────────────────────────────────────────────────────────────── */

    listProducts(filter?: ProductAdminFilter): Promise<CursorPage<ProductAdmin>>;
    getProduct(productId: ProductId): Promise<ProductAdmin>;
    createProduct(request: CreateProductRequest): Promise<ProductAdmin>;
    updateProduct(productId: ProductId, request: UpdateProductRequest): Promise<ProductAdmin>;
    archiveProduct(productId: ProductId, request: LockedRequest): Promise<ProductAdmin>;
    setProductChannelAvailability(
        productId: ProductId,
        request: SetChannelAvailabilityRequest,
    ): Promise<ProductAdmin>;

    /* ── price lists ────────────────────────────────────────────────────────────────────────── */

    listPriceLists(filter?: PriceListAdminFilter): Promise<CursorPage<PriceListAdmin>>;
    getPriceList(priceListId: PriceListId): Promise<PriceListAdmin>;
    setPriceListEntries(
        priceListId: PriceListId,
        request: SetPriceListEntriesRequest,
    ): Promise<PriceListAdmin>;
    /** Refused while any entry breaks {@link isPriceEntryConsistent}. */
    publishPriceList(priceListId: PriceListId, request: LockedRequest): Promise<PriceListAdmin>;

    /* ── meals ──────────────────────────────────────────────────────────────────────────────── */

    listMeals(filter?: MealAdminFilter): Promise<CursorPage<MealAdmin>>;
    getMeal(mealId: MealId): Promise<MealAdmin>;
    createMeal(request: CreateMealRequest): Promise<MealAdmin>;
    updateMeal(mealId: MealId, request: UpdateMealRequest): Promise<MealAdmin>;
    /** Makes the meal visible to consumers. Refused from `review_required`. */
    publishMeal(mealId: MealId, request: LockedRequest): Promise<MealAdmin>;
    retireMeal(mealId: MealId, request: LockedRequest): Promise<MealAdmin>;
    setMealAvailability(mealId: MealId, request: SetMealAvailabilityRequest): Promise<MealAdmin>;

    /* ── subscription plans ─────────────────────────────────────────────────────────────────── */

    listPlans(filter?: PlanAdminFilter): Promise<CursorPage<PlanAdmin>>;
    getPlan(planId: SubscriptionPlanId): Promise<PlanAdmin>;
    createPlan(request: CreatePlanRequest): Promise<PlanAdmin>;
    updatePlan(planId: SubscriptionPlanId, request: UpdatePlanRequest): Promise<PlanAdmin>;
    /** Refused while any price the plan needs is a placeholder (plan §3 #15). */
    publishPlan(planId: SubscriptionPlanId, request: LockedRequest): Promise<PlanAdmin>;
    retirePlan(planId: SubscriptionPlanId, request: LockedRequest): Promise<PlanAdmin>;
    setPlanVariants(
        planId: SubscriptionPlanId,
        request: SetPlanVariantsRequest,
    ): Promise<PlanAdmin>;
    setPlanDurations(
        planId: SubscriptionPlanId,
        request: SetPlanDurationsRequest,
    ): Promise<PlanAdmin>;
    setPlanCombinations(
        planId: SubscriptionPlanId,
        request: SetPlanCombinationsRequest,
    ): Promise<PlanAdmin>;
    /** The plan's fixed menu. Cycle and entries together, because they are one document. */
    getPlanMenu(planId: SubscriptionPlanId): Promise<PlanMenu>;
    /**
     * Replaces it wholesale, or withdraws it when everything is empty.
     *
     * Refused with `validation.failed` for a dish that is not a published meal of this kitchen, for
     * a day beyond the submitted cycle, and for a plan with no commercial terms yet
     * (`plan_profile_missing`) — a menu on an unconfigured plan is a menu on nothing.
     */
    replacePlanMenu(planId: SubscriptionPlanId, request: ReplacePlanMenuRequest): Promise<PlanMenu>;

    /* ── delivery zones and windows ─────────────────────────────────────────────────────────── */

    listZones(filter?: DeliveryZoneAdminFilter): Promise<CursorPage<DeliveryZoneAdmin>>;
    getZone(zoneId: DeliveryZoneId): Promise<DeliveryZoneAdmin>;
    createZone(request: CreateDeliveryZoneRequest): Promise<DeliveryZoneAdmin>;
    updateZone(
        zoneId: DeliveryZoneId,
        request: UpdateDeliveryZoneRequest,
    ): Promise<DeliveryZoneAdmin>;
    archiveZone(zoneId: DeliveryZoneId, request: LockedRequest): Promise<DeliveryZoneAdmin>;
    setZoneAreas(zoneId: DeliveryZoneId, request: SetZoneAreasRequest): Promise<DeliveryZoneAdmin>;
    setDeliveryWindows(
        zoneId: DeliveryZoneId,
        request: SetDeliveryWindowsRequest,
    ): Promise<DeliveryZoneAdmin>;

    /* ── branch operating data ──────────────────────────────────────────────────────────────── */

    getBranchOperating(branchId: KitchenBranchId): Promise<BranchOperating>;
    setBranchOperating(
        branchId: KitchenBranchId,
        request: SetBranchOperatingRequest,
    ): Promise<BranchOperating>;
}

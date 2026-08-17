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
export interface IngredientAdmin {
    readonly id: IngredientId;
    readonly meta: AdminEntityMeta;
    readonly name: LocalisedText;
    /** The kitchen's own reference, e.g. `IG-014`. `null` for a platform-library row. */
    readonly reference: string | null;
    readonly categoryCode: string;
    /** The unit the kitchen buys and issues it in. */
    readonly measurementUnit: MeasureUnit;
    /** CONFIDENTIAL — purchase cost of 100 g, major units. `null` when no cost is recorded. */
    readonly costPer100g: CostAmount | null;
    /** Per-100 g reference facts, when the ingredient has any. Never fabricated to fill the field. */
    readonly per100g: NutritionFacts | null;
    readonly allergens: readonly IngredientAllergenMapping[];
    readonly dietClassifications: readonly DietClassification[];
    /** Alternative designations seen on delivery notes and technical sheets. */
    readonly aliases: readonly string[];
    /** `null` for the shared platform library; set once a kitchen forks the row. */
    readonly organisationId: OrganisationId | null;
    readonly notes: string | null;
}

export interface IngredientAdminFilter extends CursorPageRequest, OffsetPageRequest {
    readonly query?: string | undefined;
    readonly statuses?: readonly PublishableStatus[] | undefined;
    readonly categoryCode?: string | undefined;
    readonly allergenCodes?: readonly AllergenCode[] | undefined;
    /** Only rows this organisation owns; omit for the library plus the kitchen's own forks. */
    readonly ownedOnly?: boolean | undefined;
}

export interface CreateIngredientRequest {
    readonly name: LocalisedText;
    readonly categoryCode: string;
    readonly measurementUnit: MeasureUnit;
    readonly reference?: string | undefined;
    readonly costPer100g?: CostAmount | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
    readonly aliases?: readonly string[] | undefined;
    readonly notes?: string | undefined;
}

export interface UpdateIngredientRequest extends LockedRequest {
    readonly name?: LocalisedText | undefined;
    readonly categoryCode?: string | undefined;
    readonly measurementUnit?: MeasureUnit | undefined;
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
    readonly lines: readonly RecipeLine[];
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
    readonly kitchenId: KitchenId;
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
    /** Only recipes whose current version needs re-derivation. */
    readonly staleOnly?: boolean | undefined;
}

export interface CreateRecipeRequest {
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    readonly yieldQuantity: number;
    readonly yieldUnit: MeasureUnit;
    readonly yieldPieces?: number | undefined;
    readonly wastePercent?: number | undefined;
}

export interface UpdateRecipeRequest extends LockedRequest {
    readonly name?: LocalisedText | undefined;
    readonly description?: LocalisedText | undefined;
    readonly yieldQuantity?: number | undefined;
    readonly yieldUnit?: MeasureUnit | undefined;
    readonly yieldPieces?: number | null | undefined;
    readonly wastePercent?: number | undefined;
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
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    readonly categoryCode: string;
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
    readonly channels?: readonly SalesChannel[] | undefined;
}

export interface CreateProductRequest {
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

    /* ── ingredients ────────────────────────────────────────────────────────────────────────── */

    listIngredients(filter?: IngredientAdminFilter): Promise<CursorPage<IngredientAdmin>>;
    getIngredient(ingredientId: IngredientId): Promise<IngredientAdmin>;
    createIngredient(request: CreateIngredientRequest): Promise<IngredientAdmin>;
    updateIngredient(
        ingredientId: IngredientId,
        request: UpdateIngredientRequest,
    ): Promise<IngredientAdmin>;
    /** Retires the row. Nothing is deleted: recipes and cost snapshots still point at it. */
    archiveIngredient(ingredientId: IngredientId, request: LockedRequest): Promise<IngredientAdmin>;
    setIngredientAllergens(
        ingredientId: IngredientId,
        request: SetIngredientAllergensRequest,
    ): Promise<IngredientAdmin>;

    /* ── recipes ────────────────────────────────────────────────────────────────────────────── */

    listRecipes(filter?: RecipeAdminFilter): Promise<CursorPage<RecipeAdminSummary>>;
    getRecipe(recipeId: RecipeId): Promise<RecipeAdmin>;
    createRecipe(request: CreateRecipeRequest): Promise<RecipeAdmin>;
    /** Editing a published recipe opens a new draft version; the result says which one is current. */
    updateRecipe(recipeId: RecipeId, request: UpdateRecipeRequest): Promise<RecipeAdmin>;
    setRecipeLines(recipeId: RecipeId, request: SetRecipeLinesRequest): Promise<RecipeAdmin>;
    setRecipeSteps(recipeId: RecipeId, request: SetRecipeStepsRequest): Promise<RecipeAdmin>;
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
    replacePlanMenu(
        planId: SubscriptionPlanId,
        request: ReplacePlanMenuRequest,
    ): Promise<PlanMenu>;

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

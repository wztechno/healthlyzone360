import { isPriceEntryConsistent } from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    IngredientAdmin,
    LocalisedText,
    MealAdmin,
    PlanAdmin,
    PriceListAdmin,
    ProductAdmin,
    RecipeAdminSummary,
} from '@healthy360/api-client/contracts';

import { ENTITY_FAMILIES } from './entity-registry.ts';
import { isTranslationIncomplete } from './format.ts';

/**
 * The readiness evaluator, as a pure function over what the contract actually publishes (K1.8).
 *
 * `/kitchen/review` is the one screen in this workspace that is not about a family — it is about the
 * *question* "what is stopping anything from going out?". That question is answered from five
 * families at once, so the answer is built here, in a module with no React in it, for the reason
 * every `format.ts` in this codebase exists: the interesting decisions are the ones a test should be
 * able to make assertions about without rendering a tree.
 *
 * ## What "needs review" means, and what it deliberately does not
 *
 * The master plan's readiness evaluator (§4.7) is a **server** verdict: allergen determination
 * complete, derivations current, required translations present, prices confirmed where public,
 * delivery availability real. `KitchenAdminRepository` publishes no such verdict — there is no
 * `getReadiness`, no `blockers` array, no `quarantineReason` field anywhere in the contract. So this
 * module does not invent one. It reports only what the shapes it is given can be *proved* to say:
 *
 * | Reason | Where it comes from |
 * |---|---|
 * | `quarantined` | `meta.status === 'review_required'` — the stored quarantine, every publishable family |
 * | `derivationStale` | `RecipeAdminFilter.staleOnly` — a real server filter, so it costs one request and no scan |
 * | `inconsistentPrices` | `isPriceEntryConsistent` over `PriceListAdmin.entries`, which the listing already returns in full |
 * | `unverifiedAllergens` | `IngredientAllergenMapping.verification === 'unverified'` |
 * | `missingTranslation` | `LocalisedText` with one side blank — the rule the publish gate states and `BilingualField` marks |
 * | `dataQuality` | `ProductAdmin.dataQualityFlags` — import findings the operator has not resolved |
 *
 * `RecipeAdminFilter` carries three more parameters for the recipe book's own list — `kind`,
 * `selling_status` and `category` — and the queue sends none of them: they say where a recipe is
 * filed, not what is stopping it.
 *
 * **Delivery zones and branch hours are absent, and that is the contract's shape rather than an
 * omission.** `archiveZone` is the only lifecycle method a zone has — there is no `publishZone` — so
 * nothing can put a zone into `review_required`, and a section that could never have a row in it
 * would be permanent furniture. A branch's operating week carries `AdminRecordMeta` and has no
 * publication state at all. The allergen classes are platform reference data nobody in a kitchen can
 * change. The screen says all three out loud rather than leaving their absence to be inferred.
 *
 * **Meals are reported under Recipes.** A meal is a recipe in the recipe book, edited on the
 * recipe's page, so its row is filed, keyed and addressed by its recipe — and a meal arriving beside
 * its own recipe is one row carrying both sets of reasons. A meal with no recipe yet keeps its own
 * id and links to the item address that offers to start one.
 *
 * ## Why the reasons are codes rather than sentences
 *
 * A row in this queue has to be readable in Arabic, and a sentence assembled here would be an
 * English one. So each reason is a stable code plus, where it has one, a count — and the screen
 * translates it. That is the same contract `RollupWarning` uses, and for the same reason.
 */

/* ------------------------------------------------------------------------------------------------
 * Reasons
 * ---------------------------------------------------------------------------------------------- */

export const REVIEW_REASON_CODES = [
    'quarantined',
    'derivationStale',
    'inconsistentPrices',
    'unverifiedAllergens',
    'missingTranslation',
    'dataQuality',
    'draft',
] as const;
export type ReviewReasonCode = (typeof REVIEW_REASON_CODES)[number];

export interface ReviewReason {
    readonly code: ReviewReasonCode;
    /**
     * How many of the thing the code names — inconsistent entries, unverified mappings, unresolved
     * flags. `null` for a reason that is not a count: a record is quarantined or it is not.
     */
    readonly count: number | null;
}

/**
 * Which reasons block publication outright, and which are work that has to happen before it can.
 *
 * The distinction is the plan's, not a presentation choice. A quarantine is refused *structurally*
 * (§4.7) — the store answers `validation.failed` on `status` and no amount of pressing gets past it.
 * An inconsistent price entry is refused by the publish gate for the same kind of reason. Everything
 * else is a readiness gap: real work, and not a wall. The screen tones the two differently because
 * "you cannot" and "you have not yet" are different sentences.
 */
const BLOCKING_REASONS: ReadonlySet<ReviewReasonCode> = new Set<ReviewReasonCode>([
    'quarantined',
    'inconsistentPrices',
]);

export function isBlockingReason(code: ReviewReasonCode): boolean {
    return BLOCKING_REASONS.has(code);
}

/** The strongest reason on a row — what its badge and its ordering key off. */
export function isBlocked(item: ReviewItem): boolean {
    return item.reasons.some((reason) => isBlockingReason(reason.code));
}

/* ------------------------------------------------------------------------------------------------
 * Items and sections
 * ---------------------------------------------------------------------------------------------- */

/**
 * The families this queue can report on, in the order the screen renders them. Meals are not one:
 * they are filed under the recipe book — see the module note.
 */
export const REVIEWABLE_FAMILY_KEYS = [
    'ingredients',
    'recipes',
    'products',
    'plans',
    'price-lists',
] as const;
export type ReviewableFamilyKey = (typeof REVIEWABLE_FAMILY_KEYS)[number];

export interface ReviewItem {
    readonly familyKey: ReviewableFamilyKey;
    readonly id: string;
    /**
     * The record's own handle — `ING-0142`, `RC-0007`, `RSL-0031` — which is what tells the families
     * apart in the queue's one table. `null` for a family with no reference series (meals, plans,
     * price lists) and for a row that predates its series.
     */
    readonly reference: string | null;
    readonly name: LocalisedText;
    /**
     * Deep link into the family's own editor. Built from the registry, never hand-written — with
     * one exception, a meal with no recipe, whose address is the recipe book's item screen.
     */
    readonly href: string;
    readonly status: AdminEntityMeta['status'];
    readonly updatedAt: string;
    readonly updatedByName: string | null;
    /** Never empty: an item with no reason is not in the queue at all. */
    readonly reasons: readonly ReviewReason[];
}

export interface ReviewSection {
    readonly familyKey: ReviewableFamilyKey;
    readonly items: readonly ReviewItem[];
}

export interface ReviewQueue {
    /** Only families with something to show. An all-clear queue has none. */
    readonly sections: readonly ReviewSection[];
    readonly total: number;
    /** Records refused publication outright — the count the hub card leads with. */
    readonly blocked: number;
}

/**
 * The editor address of one record.
 *
 * Derived from `ENTITY_FAMILIES` rather than from a second table of paths, so a family that moves
 * moves once. A key with no registry entry yields `null` and the row is dropped, which is safer than
 * linking somewhere that does not exist.
 */
export function editorHref(familyKey: string, id: string): string | null {
    const family = ENTITY_FAMILIES.find((candidate) => candidate.key === familyKey);
    return family === undefined ? null : `${family.href}/${id}`;
}

function itemFrom(
    familyKey: ReviewableFamilyKey,
    id: string,
    reference: string | null,
    name: LocalisedText,
    meta: AdminEntityMeta,
    reasons: readonly ReviewReason[],
    href: string | null = editorHref(familyKey, id),
): ReviewItem | null {
    if (reasons.length === 0) return null;
    if (href === null) return null;

    return {
        familyKey,
        id,
        reference,
        name,
        href,
        status: meta.status,
        updatedAt: meta.updatedAt,
        updatedByName: meta.updatedByName,
        reasons,
    };
}

/** `quarantined` when the record is in the stored quarantine, and nothing otherwise. */
function quarantineReason(meta: AdminEntityMeta): readonly ReviewReason[] {
    if (meta.status === 'review_required') return [{ code: 'quarantined', count: null }];
    // A draft is work still to finish before it can go out — never a wall, so never blocking.
    if (meta.status === 'draft') return [{ code: 'draft', count: null }];
    return [];
}

/** `missingTranslation` when either half of the name is blank — the publish gate's own rule. */
function translationReason(name: LocalisedText): readonly ReviewReason[] {
    return isTranslationIncomplete(name) ? [{ code: 'missingTranslation', count: null }] : [];
}

/* ------------------------------------------------------------------------------------------------
 * Per-family builders
 * ---------------------------------------------------------------------------------------------- */

export function ingredientReviewItems(rows: readonly IngredientAdmin[]): readonly ReviewItem[] {
    return rows.flatMap((row) => {
        const unverified = row.allergens.filter(
            (mapping) => mapping.verification === 'unverified',
        ).length;

        const item = itemFrom('ingredients', String(row.id), row.reference, row.name, row.meta, [
            ...quarantineReason(row.meta),
            ...(unverified === 0
                ? []
                : [{ code: 'unverifiedAllergens' as const, count: unverified }]),
            ...translationReason(row.name),
        ]);
        return item === null ? [] : [item];
    });
}

/**
 * Recipes, from two listings merged on identity.
 *
 * `RecipeAdminFilter` publishes `statuses`, `staleOnly`, `kind`, `selling_status` and `category` as
 * separate parameters and no way to ask for a union of any of them, so a recipe can legitimately
 * arrive from both listings — quarantined *and* stale — and must appear once carrying both reasons
 * rather than twice carrying one each.
 */
export function recipeReviewItems(
    quarantinedRows: readonly RecipeAdminSummary[],
    staleRows: readonly RecipeAdminSummary[],
): readonly ReviewItem[] {
    const stale = new Set(staleRows.map((row) => String(row.id)));
    const merged = new Map<string, RecipeAdminSummary>();
    for (const row of [...quarantinedRows, ...staleRows]) merged.set(String(row.id), row);

    return [...merged.values()].flatMap((row) => {
        const item = itemFrom('recipes', String(row.id), row.reference, row.name, row.meta, [
            ...quarantineReason(row.meta),
            ...(stale.has(String(row.id))
                ? [{ code: 'derivationStale' as const, count: null }]
                : []),
            ...translationReason(row.name),
        ]);
        return item === null ? [] : [item];
    });
}

export function productReviewItems(rows: readonly ProductAdmin[]): readonly ReviewItem[] {
    return rows.flatMap((row) => {
        const item = itemFrom('products', String(row.id), row.reference, row.name, row.meta, [
            ...quarantineReason(row.meta),
            ...(row.dataQualityFlags.length === 0
                ? []
                : [{ code: 'dataQuality' as const, count: row.dataQualityFlags.length }]),
            ...translationReason(row.name),
        ]);
        return item === null ? [] : [item];
    });
}

/**
 * Meals, filed under the recipe book.
 *
 * A meal with a recipe is keyed and addressed by the recipe, so it lands on the recipe's page and
 * merges with the recipe's own row when both are listed ({@link mergeById}). One with no recipe
 * keeps its own id and links to the item address, which offers to start one.
 */
export function mealReviewItems(rows: readonly MealAdmin[]): readonly ReviewItem[] {
    return rows.flatMap((row) => {
        const reasons = [...quarantineReason(row.meta), ...translationReason(row.name)];
        const item =
            row.recipeId === null
                ? itemFrom(
                      'recipes',
                      String(row.id),
                      null,
                      row.name,
                      row.meta,
                      reasons,
                      `/kitchen/recipes/item/${String(row.id)}?kind=meal`,
                  )
                : itemFrom('recipes', String(row.recipeId), null, row.name, row.meta, reasons);
        return item === null ? [] : [item];
    });
}

/**
 * One row per id, carrying every reason any of its rows gave, each code once.
 *
 * The first row keeps its name, handle and address — for a meal filed under its recipe that is the
 * recipe's own row whenever both are listed, because recipes are built first.
 */
function mergeById(items: readonly ReviewItem[]): readonly ReviewItem[] {
    const merged = new Map<string, ReviewItem>();
    for (const item of items) {
        const held = merged.get(item.id);
        merged.set(
            item.id,
            held === undefined
                ? item
                : {
                      ...held,
                      reasons: [
                          ...held.reasons,
                          ...item.reasons.filter(
                              (reason) => !held.reasons.some((kept) => kept.code === reason.code),
                          ),
                      ],
                  },
        );
    }
    return [...merged.values()];
}

export function planReviewItems(rows: readonly PlanAdmin[]): readonly ReviewItem[] {
    return rows.flatMap((row) => {
        const item = itemFrom('plans', String(row.id), null, row.name, row.meta, [
            ...quarantineReason(row.meta),
            ...translationReason(row.name),
        ]);
        return item === null ? [] : [item];
    });
}

/**
 * Price lists, which are the one family whose reason is counted from the rows themselves.
 *
 * `listPriceLists` answers with whole records — entries included — so the migration's `CHECK`
 * (a confirmed price has an amount and nothing else does) can be evaluated here for nothing. A list
 * carrying an inconsistent entry cannot be published at all, which is why the count is stated: "one
 * entry of forty" and "thirty of forty" are the same refusal and completely different jobs.
 */
export function priceListReviewItems(rows: readonly PriceListAdmin[]): readonly ReviewItem[] {
    return rows.flatMap((row) => {
        const inconsistent = row.entries.filter((entry) => !isPriceEntryConsistent(entry)).length;

        const item = itemFrom('price-lists', String(row.id), null, row.name, row.meta, [
            ...quarantineReason(row.meta),
            ...(inconsistent === 0
                ? []
                : [{ code: 'inconsistentPrices' as const, count: inconsistent }]),
            ...translationReason(row.name),
        ]);
        return item === null ? [] : [item];
    });
}

/* ------------------------------------------------------------------------------------------------
 * The queue
 * ---------------------------------------------------------------------------------------------- */

/** Everything the aggregated query fetched, before it becomes a queue. */
export interface ReviewSources {
    readonly ingredients: readonly IngredientAdmin[];
    readonly quarantinedRecipes: readonly RecipeAdminSummary[];
    readonly staleRecipes: readonly RecipeAdminSummary[];
    readonly products: readonly ProductAdmin[];
    readonly meals: readonly MealAdmin[];
    readonly plans: readonly PlanAdmin[];
    readonly priceLists: readonly PriceListAdmin[];
}

/**
 * The queue, in the screen's order.
 *
 * Sections follow {@link REVIEWABLE_FAMILY_KEYS} — the same order the hub lists the families in, so
 * the two screens do not disagree about where recipes come. Rows inside a section are ordered
 * **blocked first, then oldest change first**: a record nobody can publish outranks one that merely
 * needs finishing, and among equals the one that has been sitting longest is the one to look at.
 *
 * Empty sections are dropped rather than rendered empty, because a heading with nothing under it
 * reads as a loading state that never resolved.
 */
export function buildReviewQueue(sources: ReviewSources): ReviewQueue {
    const byFamily: Record<ReviewableFamilyKey, readonly ReviewItem[]> = {
        ingredients: ingredientReviewItems(sources.ingredients),
        recipes: mergeById([
            ...recipeReviewItems(sources.quarantinedRecipes, sources.staleRecipes),
            ...mealReviewItems(sources.meals),
        ]),
        products: productReviewItems(sources.products),
        plans: planReviewItems(sources.plans),
        'price-lists': priceListReviewItems(sources.priceLists),
    };

    const sections: ReviewSection[] = [];
    let total = 0;
    let blocked = 0;

    for (const familyKey of REVIEWABLE_FAMILY_KEYS) {
        const items = [...byFamily[familyKey]].sort((left, right) => {
            const leftBlocked = isBlocked(left);
            const rightBlocked = isBlocked(right);
            if (leftBlocked !== rightBlocked) return leftBlocked ? -1 : 1;
            return left.updatedAt.localeCompare(right.updatedAt);
        });
        if (items.length === 0) continue;

        sections.push({ familyKey, items });
        total += items.length;
        blocked += items.filter((item) => isBlocked(item)).length;
    }

    return { sections, total, blocked };
}

/** The test id of one queue row, so a spec need not rebuild the string. */
export function reviewRowTestId(familyKey: string, id: string): string {
    return `kitchen-review-${familyKey}-${id}`;
}

const REASON_KEYS: Readonly<Record<ReviewReasonCode, string>> = {
    quarantined: 'kitchen:review.reasonQuarantined',
    derivationStale: 'kitchen:review.reasonDerivationStale',
    inconsistentPrices: 'kitchen:review.reasonInconsistentPrices',
    unverifiedAllergens: 'kitchen:review.reasonUnverifiedAllergens',
    missingTranslation: 'kitchen:review.reasonMissingTranslation',
    dataQuality: 'kitchen:review.reasonDataQuality',
    draft: 'kitchen:review.reasonDraft',
};

export function reviewReasonKey(code: ReviewReasonCode): string {
    return REASON_KEYS[code];
}

const FAMILY_KEYS: Readonly<Record<ReviewableFamilyKey, string>> = {
    ingredients: 'kitchen:families.ingredients.name',
    recipes: 'kitchen:families.recipes.name',
    products: 'kitchen:families.products.name',
    plans: 'kitchen:families.plans.name',
    'price-lists': 'kitchen:families.priceLists.name',
};

/**
 * The heading of one section.
 *
 * Borrowed from the family registry's own name key rather than restated under `review.`: the queue
 * and the hub are naming the same five things, and two translations of "Price lists" would drift the
 * first time somebody edited one of them.
 */
export function reviewFamilyKey(familyKey: ReviewableFamilyKey): string {
    return FAMILY_KEYS[familyKey];
}

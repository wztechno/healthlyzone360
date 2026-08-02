import type {
    CartId,
    CorporateProgrammeId,
    DeliveryZoneId,
    DietitianId,
    IngredientId,
    KitchenBranchId,
    KitchenId,
    MealId,
    MealPlanEntryId,
    MealPlanId,
    PriceListId,
    ProductId,
    RecipeId,
    SubscriptionId,
    SubscriptionPlanId,
    UserId,
    VdSessionId,
} from '@healthy360/domain-types';

/**
 * Query keys, in one place.
 *
 * Every key starts with a *root* that says what kind of data it is, because the offline persistence
 * allow-list (§21) is expressed in terms of those roots. A key invented at a call site would bypass
 * that classification, so keys are never written inline.
 *
 * ## Why the whole map is written here, before most of it is used
 *
 * This file is a chokepoint: five parallel waves build screens over the same eleven roots, and five
 * simultaneous edits to one exported object is the single most likely way this codebase gets a
 * duplicate-but-subtly-different key (`['planner','week',id]` in one place, `['planner',id,'week']`
 * in another — two caches for one fact, and an invalidation that misses half of them). So the map
 * is complete from the start. **Later waves read this file and do not edit it.** A wave that needs a
 * key which is genuinely absent asks for it rather than adding one.
 *
 * `kitchenAdmin` is the twelfth root, added whole by K1 for the same reason: the kitchen workspace
 * is several slices, and each of them would otherwise edit this object.
 *
 * ## Shape rules
 *
 * 1. `[root, ...path, ...params]` — root first, then a stable path, then the parameters, so a
 *    prefix invalidation (`queryKeys.planner.all()`) always covers everything below it.
 * 2. Parameters that identify a *row* are the branded identifier itself.
 * 3. Parameters that describe a *view* — filters, cursors, configurations — are passed as one
 *    object. TanStack hashes object keys deterministically, so `{ query: 'a', limit: 10 }` and
 *    `{ limit: 10, query: 'a' }` are the same key. `null` stands in for "no filter" so that the
 *    unfiltered list and the empty-object-filtered list share a cache entry.
 * 4. Nothing is ever `undefined` inside a key: `undefined` members are dropped by the hasher, which
 *    silently collapses two different requests onto one entry.
 */

export const QUERY_ROOTS = [
    'session',
    'devices',
    'reference',
    'marketplace',
    'catalogue',
    'nutrition',
    'planner',
    'vd',
    'commerce',
    'business',
    'professional',
    'kitchenAdmin',
] as const;
export type QueryRoot = (typeof QUERY_ROOTS)[number];

/**
 * A view descriptor — a filter, a cursor request or a proposed configuration.
 *
 * Typed as `object` rather than `Record<string, unknown>` on purpose: the contract filters are
 * `interface`s, and an interface without an index signature is not assignable to a `Record`. The
 * only real requirement is that the value is JSON-serialisable, which every contract filter is.
 */
export type QueryScope = object;

function scope(value: QueryScope | undefined): QueryScope | null {
    return value ?? null;
}

export const queryKeys = {
    // ── session (never persisted) ───────────────────────────────────────────────────────────────

    /** `GET /api/v1/me` — user, profile, memberships, active context, pending consents. */
    me: () => ['session', 'me'] as const,
    /** `GET /api/v1/auth/email/status`. */
    emailVerification: () => ['session', 'email-verification'] as const,
    /** `GET /api/v1/me/devices`. */
    devices: () => ['devices', 'list'] as const,
    /** Static, non-personal lookup data — the only family the cache may persist. */
    locales: () => ['reference', 'locales'] as const,

    /**
     * ── marketplace: the provider directory ─────────────────────────────────────────────────────
     *
     * Kitchens and dietitians. Public, but *volatile*: opening hours, delivery zones, accepting-
     * clients flags and ratings all move, and a stale delivery zone is a person told they can be
     * fed when they cannot. Deliberately **not** in the persistence allow-list for that reason.
     */
    marketplace: {
        all: () => ['marketplace'] as const,
        kitchens: (filter?: QueryScope) => ['marketplace', 'kitchens', scope(filter)] as const,
        kitchen: (kitchenId: KitchenId) => ['marketplace', 'kitchen', kitchenId] as const,
        /** The consumer-visible menu of one kitchen — `listMeals({ kitchenIds: [id] })`. */
        kitchenMenu: (kitchenId: KitchenId, filter?: QueryScope) =>
            ['marketplace', 'kitchen', kitchenId, 'menu', scope(filter)] as const,
        dietitians: (filter?: QueryScope) => ['marketplace', 'dietitians', scope(filter)] as const,
        dietitian: (dietitianId: DietitianId) => ['marketplace', 'dietitian', dietitianId] as const,
    },

    /**
     * ── catalogue: the item catalogue ───────────────────────────────────────────────────────────
     *
     * Meals, plans, diet categories, recipes and foods. Public, non-personal and *stable* — a meal's
     * composition and nutrition facts do not change between two sessions — which is exactly the
     * property that makes this the one root allowed to survive a restart (plan §5).
     */
    catalogue: {
        all: () => ['catalogue'] as const,
        meals: (filter?: QueryScope) => ['catalogue', 'meals', scope(filter)] as const,
        meal: (mealId: MealId) => ['catalogue', 'meal', mealId] as const,
        plans: (filter?: QueryScope) => ['catalogue', 'plans', scope(filter)] as const,
        plan: (planId: SubscriptionPlanId) => ['catalogue', 'plan', planId] as const,
        /** Side-by-side comparison. The identifiers are sorted by the caller so order is not a key. */
        planComparison: (planIds: readonly SubscriptionPlanId[]) =>
            ['catalogue', 'plans', 'comparison', [...planIds].sort()] as const,
        dietCategories: () => ['catalogue', 'diets'] as const,
        dietCategory: (slug: string) => ['catalogue', 'diet', slug] as const,
        recipes: (filter?: QueryScope) => ['catalogue', 'recipes', scope(filter)] as const,
        recipe: (recipeId: RecipeId) => ['catalogue', 'recipe', recipeId] as const,
        /** `GET /api/v1/foods` — always query-driven, so the query itself is part of the key. */
        foods: (filter: QueryScope) => ['catalogue', 'foods', filter] as const,
    },

    /**
     * ── nutrition: targets and their review ─────────────────────────────────────────────────────
     *
     * Personal and medical-adjacent. Memory only, always.
     */
    nutrition: {
        all: () => ['nutrition'] as const,
        /** `GET /api/v1/nutrition/targets/current`. `null` before onboarding produces one. */
        currentTargets: () => ['nutrition', 'targets', 'current'] as const,
        /**
         * `POST /api/v1/nutrition/calculate-targets` read as a query: it stores nothing, so a given
         * request always has the same answer and caching it by its inputs is correct. The public
         * calculators use this without a session.
         */
        calculation: (request: QueryScope) => ['nutrition', 'calculation', request] as const,
        reviews: (filter?: QueryScope) => ['nutrition', 'reviews', scope(filter)] as const,
    },

    /**
     * ── planner: the generated week ─────────────────────────────────────────────────────────────
     *
     * `week` and `day` are separate entries over the same entries on purpose: a day regeneration
     * invalidates one day, a week regeneration invalidates the prefix, and neither has to know how
     * the other is stored.
     */
    planner: {
        all: () => ['planner'] as const,
        /**
         * The plan the person is currently following.
         *
         * **Contract gap.** No proposed operation lists a person's meal plans — every planner
         * endpoint takes a `{plan}` the client is assumed to already hold
         * (`docs/api/proposed/meal-plans.v1.draft.yaml`). Until a `GET /api/v1/meal-plans` (or a
         * `currentPlanId` on `GET /api/v1/me`) exists, the application resolves it indirectly; this
         * key exists so that resolution is cached once rather than repeated per screen.
         */
        currentPlan: () => ['planner', 'current-plan'] as const,
        week: (planId: MealPlanId, weekStart: string) =>
            ['planner', 'week', planId, weekStart] as const,
        day: (planId: MealPlanId, date: string) => ['planner', 'day', planId, date] as const,
        entry: (planId: MealPlanId, entryId: MealPlanEntryId) =>
            ['planner', 'entry', planId, entryId] as const,
        notes: (planId: MealPlanId) => ['planner', 'notes', planId] as const,
        history: (planId: MealPlanId, request?: QueryScope) =>
            ['planner', 'history', planId, scope(request)] as const,
        /** The replacement drawer's search — scoped to the entry it is replacing. */
        replacements: (planId: MealPlanId, entryId: MealPlanEntryId, filter?: QueryScope) =>
            ['planner', 'replacements', planId, entryId, scope(filter)] as const,
        /** `GET /api/v1/grocery-lists/{week}` — `week` is the Monday, `YYYY-MM-DD`. */
        grocery: (weekStart: string) => ['planner', 'grocery', weekStart] as const,
        pantry: () => ['planner', 'pantry'] as const,
    },

    /** ── virtual dietitian ──────────────────────────────────────────────────────────────────── */
    vd: {
        all: () => ['vd'] as const,
        sessions: (request?: QueryScope) => ['vd', 'sessions', scope(request)] as const,
        session: (sessionId: VdSessionId) => ['vd', 'session', sessionId] as const,
    },

    /**
     * ── commerce: cart, checkout preview, subscriptions ─────────────────────────────────────────
     *
     * The two `preview` entries are queries over a *proposed* configuration — they reserve nothing
     * and charge nothing (`contracts/commerce.ts`), which is what makes caching them by their
     * inputs safe.
     */
    commerce: {
        all: () => ['commerce'] as const,
        cart: () => ['commerce', 'cart'] as const,
        checkoutPreview: (request: QueryScope) =>
            ['commerce', 'checkout', 'preview', request] as const,
        subscriptions: (filter?: QueryScope) =>
            ['commerce', 'subscriptions', scope(filter)] as const,
        subscription: (subscriptionId: SubscriptionId) =>
            ['commerce', 'subscription', subscriptionId] as const,
        subscriptionPreview: (configuration: QueryScope) =>
            ['commerce', 'subscription', 'preview', configuration] as const,
        /** Cart lines addressed individually, for optimistic quantity edits. */
        cartItem: (cartId: CartId, itemId: string) =>
            ['commerce', 'cart', cartId, 'item', itemId] as const,
    },

    /**
     * ── business: corporate programmes, catalogue and quotations ────────────────────────────────
     *
     * Negotiated prices live behind this root and only this root. Nothing under `catalogue` or
     * `marketplace` may ever hold a contract price (`contracts/business.ts`).
     */
    business: {
        all: () => ['business'] as const,
        programme: (programmeId: CorporateProgrammeId) =>
            ['business', 'programme', programmeId] as const,
        catalogue: (filter: QueryScope) => ['business', 'catalogue', filter] as const,
        catalogueItem: (itemId: string) => ['business', 'catalogue', 'item', itemId] as const,
        quotations: (filter?: QueryScope) => ['business', 'quotations', scope(filter)] as const,
    },

    /** ── professional: the dietitian's review queue and client work ─────────────────────────── */
    professional: {
        all: () => ['professional'] as const,
        reviewQueue: (filter?: QueryScope) =>
            ['professional', 'review-queue', scope(filter)] as const,
        review: (reviewId: string) => ['professional', 'review', reviewId] as const,
        clientPlan: (clientId: UserId, planId: MealPlanId, weekStart: string) =>
            ['professional', 'client-plan', clientId, planId, weekStart] as const,
    },

    /**
     * ── kitchenAdmin: the kitchen workspace (K1) ────────────────────────────────────────────────
     *
     * One entry per entity family plus a detail-by-identifier, so a mutation invalidates the list it
     * changed and the row it changed, and a lifecycle action invalidates the family prefix.
     *
     * **Never persisted, and the reason is not "personal data".** This root holds purchase costs,
     * technical-sheet cost lines and margins, and the device it renders on is a shared kitchen
     * tablet that several people sign into. Writing that to disk would leave one kitchen's costs
     * readable by the next person to pick the tablet up, without anybody having signed in at all.
     * `PERSISTABLE_QUERY_ROOTS` below therefore stays `['reference', 'catalogue']`.
     */
    kitchenAdmin: {
        all: () => ['kitchenAdmin'] as const,

        /** Platform reference, read-only in this workspace. */
        allergenClasses: () => ['kitchenAdmin', 'allergen-classes'] as const,
        serviceAreas: (filter?: QueryScope) =>
            ['kitchenAdmin', 'service-areas', scope(filter)] as const,

        ingredients: (filter?: QueryScope) =>
            ['kitchenAdmin', 'ingredients', scope(filter)] as const,
        ingredient: (ingredientId: IngredientId) =>
            ['kitchenAdmin', 'ingredient', ingredientId] as const,

        recipes: (filter?: QueryScope) => ['kitchenAdmin', 'recipes', scope(filter)] as const,
        recipe: (recipeId: RecipeId) => ['kitchenAdmin', 'recipe', recipeId] as const,
        /**
         * The line editor's roll-up preview.
         *
         * Keyed by a **hash of the draft** rather than by the recipe: the preview is a pure function
         * of the lines on screen, most of which are not saved and some of which belong to a recipe
         * that does not exist yet. Two people composing the same lines share one cache entry, and
         * an entry cannot outlive the draft that produced it. The caller computes the hash — the key
         * map must stay free of hashing policy, or two call sites will hash differently and split
         * the cache in half.
         */
        recipeRollup: (draftHash: string) =>
            ['kitchenAdmin', 'recipe', 'rollup', draftHash] as const,

        products: (filter?: QueryScope) => ['kitchenAdmin', 'products', scope(filter)] as const,
        product: (productId: ProductId) => ['kitchenAdmin', 'product', productId] as const,

        priceLists: (filter?: QueryScope) =>
            ['kitchenAdmin', 'price-lists', scope(filter)] as const,
        priceList: (priceListId: PriceListId) =>
            ['kitchenAdmin', 'price-list', priceListId] as const,

        meals: (filter?: QueryScope) => ['kitchenAdmin', 'meals', scope(filter)] as const,
        meal: (mealId: MealId) => ['kitchenAdmin', 'meal', mealId] as const,

        plans: (filter?: QueryScope) => ['kitchenAdmin', 'plans', scope(filter)] as const,
        plan: (planId: SubscriptionPlanId) => ['kitchenAdmin', 'plan', planId] as const,

        zones: (filter?: QueryScope) => ['kitchenAdmin', 'zones', scope(filter)] as const,
        zone: (zoneId: DeliveryZoneId) => ['kitchenAdmin', 'zone', zoneId] as const,

        branchOperating: (branchId: KitchenBranchId) =>
            ['kitchenAdmin', 'branch-operating', branchId] as const,

        /**
         * The publication review queue (K1.8) — one entry for the whole workbench.
         *
         * Deliberately parameterless. The queue is an aggregate over six families, and the hub card
         * and the `/kitchen/review` screen ask for exactly the same aggregate: giving it one key
         * means opening the queue from the hub costs nothing, and that a write anywhere in the
         * workspace invalidates it along with everything else under the root prefix.
         */
        review: () => ['kitchenAdmin', 'review'] as const,
    },
} as const;

/**
 * Roots whose cached data may survive a restart.
 *
 * Deliberately minimal (plan §21). `session`, `devices`, `nutrition`, `planner`, `vd`, `commerce`,
 * `business`, `professional` and `kitchenAdmin` are absent and must stay absent: they are
 * authentication responses, personal data, medical-adjacent data, or — in `kitchenAdmin`'s case —
 * confidential commercial data on a device several people share. Adding a root here is a privacy
 * decision, which is why it is a single reviewable list rather than a per-query flag.
 *
 * **Known deviation from plan §5.** The plan adds `catalogue` here — public, non-personal item data
 * that is cheap to keep. It is not added yet because `persistence.test.ts` pins this list to
 * `['reference']` exactly, and that test is outside this wave's ownership. The two edits belong in
 * one commit; see the wave report.
 */
// `catalogue` joined at the Prompt 2 Wave 2 gate (plan §5): public marketplace catalogue data is
// exactly what foundation plan §21 permits on disk. planner / nutrition / vd / commerce / business
// are personal and must never be persisted.
export const PERSISTABLE_QUERY_ROOTS: readonly QueryRoot[] = ['reference', 'catalogue'];

export function isPersistableQueryKey(key: readonly unknown[]): boolean {
    const root = key[0];
    return (
        typeof root === 'string' && (PERSISTABLE_QUERY_ROOTS as readonly string[]).includes(root)
    );
}

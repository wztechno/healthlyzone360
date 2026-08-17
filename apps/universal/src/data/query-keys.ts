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
    OrderId,
    PriceListId,
    ProductId,
    QuotationId,
    RecipeId,
    SubscriptionId,
    SubscriptionPlanId,
    SupplierId,
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
 * `account` and `verification` are the thirteenth and fourteenth, added whole by J1 on the same
 * terms: the D2C account area is five screens (checklist, contacts, addresses, allergy declaration,
 * consents) and the one-time-code surface is shared with journeys that have no account at all —
 * guest ordering, B2B signatories — which is exactly why the challenge does not hang off `account`.
 * Neither is ever persisted; both are stated in `PERSISTABLE_QUERY_ROOTS`'s note below.
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
    'kitchenOps',
    'kitchenOrders',
    'orderDesk',
    'kitchenQuotations',
    'account',
    'verification',
    'guest',
    'b2bApplication',
    'platformAdmin',
    'invitations',
    'driverJobs',
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
        cart: (channelCode?: string) => ['commerce', 'cart', channelCode ?? 'web-shop'] as const,
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

        /**
         * S1. Three entries under the existing root rather than a new one, because a balance, a
         * ledger and a quote are all facts about the same commerce surface — and every subscription
         * mutation already invalidates the whole `commerce` prefix, which is exactly what has to
         * happen when a skip changes the ledger *and* the next delivery date.
         *
         * `subscriptionQuote` is keyed by the proposal rather than by the subscription: it is a
         * query over a configuration nobody has bought yet, and it is what replaced seven previews.
         */
        subscriptionBalance: (subscriptionId: SubscriptionId) =>
            ['commerce', 'subscription', subscriptionId, 'balance'] as const,
        subscriptionDeliveries: (subscriptionId: SubscriptionId, filter?: QueryScope) =>
            ['commerce', 'subscription', subscriptionId, 'deliveries', scope(filter)] as const,
        subscriptionQuote: (request: QueryScope) =>
            ['commerce', 'subscription', 'quote', request] as const,
        subscriptionMealChoices: (subscriptionId: SubscriptionId, date: string) =>
            ['commerce', 'subscription', subscriptionId, 'meal-choices', date] as const,
    },

    /**
     * ── business: corporate programmes, catalogue and quotations ────────────────────────────────
     *
     * Negotiated prices live behind this root and only this root. Nothing under `catalogue` or
     * `marketplace` may ever hold a contract price (`contracts/business.ts`).
     */
    business: {
        all: () => ['business'] as const,
        programmes: () => ['business', 'programmes'] as const,
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
        /**
         * One numbered page of the same collection.
         *
         * A separate path segment rather than the page folded into the filter object, for a
         * reason TanStack enforces rather than suggests: an infinite query and a plain query
         * that share a key store incompatible shapes in one entry — `{pages: [...]}` against a
         * bare page — and whichever mounts second reads the other's data as its own. The
         * `['kitchenAdmin', 'ingredients']` prefix still covers both, so invalidation is
         * unaffected. Same for the six below.
         */
        ingredientsPage: (filter: QueryScope | undefined, page: number) =>
            ['kitchenAdmin', 'ingredients', 'page', scope(filter), page] as const,
        ingredient: (ingredientId: IngredientId) =>
            ['kitchenAdmin', 'ingredient', ingredientId] as const,

        recipes: (filter?: QueryScope) => ['kitchenAdmin', 'recipes', scope(filter)] as const,
        recipesPage: (filter: QueryScope | undefined, page: number) =>
            ['kitchenAdmin', 'recipes', 'page', scope(filter), page] as const,
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
        productsPage: (filter: QueryScope | undefined, page: number) =>
            ['kitchenAdmin', 'products', 'page', scope(filter), page] as const,
        product: (productId: ProductId) => ['kitchenAdmin', 'product', productId] as const,

        priceLists: (filter?: QueryScope) =>
            ['kitchenAdmin', 'price-lists', scope(filter)] as const,
        priceListsPage: (filter: QueryScope | undefined, page: number) =>
            ['kitchenAdmin', 'price-lists', 'page', scope(filter), page] as const,
        priceList: (priceListId: PriceListId) =>
            ['kitchenAdmin', 'price-list', priceListId] as const,

        meals: (filter?: QueryScope) => ['kitchenAdmin', 'meals', scope(filter)] as const,
        mealsPage: (filter: QueryScope | undefined, page: number) =>
            ['kitchenAdmin', 'meals', 'page', scope(filter), page] as const,
        meal: (mealId: MealId) => ['kitchenAdmin', 'meal', mealId] as const,

        plans: (filter?: QueryScope) => ['kitchenAdmin', 'plans', scope(filter)] as const,
        plansPage: (filter: QueryScope | undefined, page: number) =>
            ['kitchenAdmin', 'plans', 'page', scope(filter), page] as const,
        plan: (planId: SubscriptionPlanId) => ['kitchenAdmin', 'plan', planId] as const,
        /**
         * The plan's fixed menu — its own entry rather than part of the record.
         *
         * `getPlan` does not carry it and the editor's other four sections do not need it, so
         * folding it into the detail key would make every plan read fetch a menu nobody asked for.
         * Saving the menu invalidates both: the write moves the *item's* lock version, which is the
         * number the other four sections send with their next save.
         */
        planMenu: (planId: SubscriptionPlanId) => ['kitchenAdmin', 'plan-menu', planId] as const,

        zones: (filter?: QueryScope) => ['kitchenAdmin', 'zones', scope(filter)] as const,
        zonesPage: (filter: QueryScope | undefined, page: number) =>
            ['kitchenAdmin', 'zones', 'page', scope(filter), page] as const,
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

    /**
     * ── kitchenOps: inventory, receipts-only procurement, production and quality control (O1–O4)
     * ────────────────────────────────────────────────────────────────────────────────────────────
     *
     * Its own root rather than a branch of `kitchenAdmin` for the same reason `KitchenOpsRepository`
     * is a sibling contract rather than a branch of it (`contracts/kitchen-ops.ts`'s header): none
     * of these rows is lock-versioned, and every list here is either the whole table (stock items,
     * suppliers) or the most recent fifty (goods receipts, production orders, quality checks).
     *
     * **`supplier` is the one row-by-identifier entry**, added by SUP1 and the exception to what
     * this group used to say. Every other ops mutation form re-reads the list it just changed,
     * because there is nothing to a stock level a list row does not already show. A supplier has
     * its own page — a record form plus a contact set no list row carries — so it is read by id,
     * and it is the only entry here that needs a key of its own.
     *
     * **Never persisted**, on the same terms as `kitchenAdmin`: a stock level and a goods receipt
     * are exactly as tied to one kitchen's costs as a technical-sheet line is, and this workspace
     * runs on a shared tablet.
     */
    kitchenOps: {
        all: () => ['kitchenOps'] as const,
        stockItems: () => ['kitchenOps', 'stock-items'] as const,
        stockLevels: () => ['kitchenOps', 'stock-levels'] as const,
        lowStockCount: () => ['kitchenOps', 'low-stock-count'] as const,
        suppliers: (filter: object = {}) => ['kitchenOps', 'suppliers', filter] as const,
        supplier: (supplierId: SupplierId) => ['kitchenOps', 'supplier', supplierId] as const,
        procurementReference: () => ['kitchenOps', 'procurement-reference'] as const,
        goodsReceipts: () => ['kitchenOps', 'goods-receipts'] as const,
        /**
         * The latest purchase of a specific set of shelves (SUP2).
         *
         * Keyed on the sorted, joined identifier list rather than on the array itself: the stock
         * screen derives the ids from a memoised list, and two renders that produced the same set
         * in a different order must be one cache entry rather than two requests for one answer.
         */
        itemLatestPurchases: (stockItemIds: readonly string[]) =>
            ['kitchenOps', 'item-latest-purchases', [...stockItemIds].sort().join(',')] as const,
        /**
         * How many shelves at one branch need ordering (SUP3).
         *
         * Keyed on the branch, unlike `lowStockCount` beside it. That one narrows through the
         * `X-Branch-Id` header, so switching branch changes the whole context and the cache with
         * it; this one takes the branch as a *question*, and two branches' answers are two entries.
         */
        supplyNeedsCount: (branchId: string) =>
            ['kitchenOps', 'supply-needs-count', branchId] as const,
        /**
         * One branch's order proposal, plus whatever was manually added to it (SUP3).
         *
         * The id list is sorted and joined for the same reason `itemLatestPurchases` sorts its own:
         * the builder derives the set from row state, and two renders that produced the same shelves
         * in a different order must be one cache entry rather than two requests for one answer.
         */
        orderProposal: (branchId: string, stockItemIds: readonly string[] = []) =>
            ['kitchenOps', 'order-proposal', branchId, [...stockItemIds].sort().join(',')] as const,
        purchasesLedger: (filter: object = {}) =>
            ['kitchenOps', 'purchases-ledger', filter] as const,
        costReport: (filter: object = {}) => ['kitchenOps', 'cost-report', filter] as const,
        consumptionExceptions: (filter: object = {}) =>
            ['kitchenOps', 'consumption-exceptions', filter] as const,
        consumptionExceptionCount: () => ['kitchenOps', 'consumption-exception-count'] as const,
        productionOrders: () => ['kitchenOps', 'production-orders'] as const,
        qualityChecks: () => ['kitchenOps', 'quality-checks'] as const,
    },

    /**
     * ── kitchenOrders: the seller's view of the orders placed against this kitchen ───────────────
     * ────────────────────────────────────────────────────────────────────────────────────────────
     *
     * Its own root rather than a branch of `commerce`, for the reason
     * `api-client/src/contracts/kitchen-orders.ts`'s header gives: `commerce` caches the *buyer's*
     * receipt, and this caches the seller's ticket — the same underlying row, two different shapes,
     * two different audiences, and an invalidation that should never cross between them. A kitchen
     * confirming an order must not evict a customer's order history, and vice versa.
     *
     * Unlike `kitchenOps`, this family **does** have a row-by-identifier entry: the detail panel
     * reads one order on its own, and it is the entry that carries the `lockVersion` the three
     * lifecycle actions send as `If-Match`.
     *
     * **Never persisted**, on the same terms as `kitchenAdmin` and `kitchenOps`, and one step
     * further out than either: an order carries a named customer's delivery address, so it is
     * commercial data *and* somebody else's personal data, on a tablet the whole kitchen signs into.
     */
    kitchenOrders: {
        all: () => ['kitchenOrders'] as const,
        list: (filter?: QueryScope) => ['kitchenOrders', 'list', scope(filter)] as const,
        order: (orderId: OrderId) => ['kitchenOrders', 'order', orderId] as const,
    },

    /**
     * ── orderDesk: the open book in the order somebody at a desk has to work it ──────────────────
     * ────────────────────────────────────────────────────────────────────────────────────────────
     *
     * Added whole by the Order Desk wave, which owns this file's change for that slice — the
     * header's rule is that a later wave asks rather than edits, and this is the wave that was
     * asked.
     *
     * Its own root rather than a branch of `kitchenOrders`, and the reason is invalidation rather
     * than taxonomy. They read the same rows through two endpoints with two different sorts, and a
     * desk agent polling a queue every fifteen seconds must not be evicting the order book from
     * under a manager working the detail panel beside them. When the desk gains its own writes they
     * will invalidate both roots explicitly, which is a decision somebody can read; one shared root
     * would make the coupling implicit and permanent.
     *
     * One entry, and `queue(filters)` takes the whole filter object per shape rule 3 — window,
     * branch, statuses, delivery-window code and the order-number search are one *view*, so two
     * screens asking for the same view share an entry and a filter change is a different entry
     * rather than a mutation of this one. There is no by-identifier entry: the queue's detail read
     * is `kitchenOrders.order(id)`, because the thing being opened is the order.
     *
     * **Never persisted, and one step further out than `kitchenOrders`.** These rows carry a named
     * customer's *display name and telephone number* — disclosed only to a caller holding
     * `order.view_customer_contact_organisation` — on a tablet at a counter that the whole kitchen
     * signs into and that members of the public stand in front of. Writing them to disk would
     * outlive both the session and the permission that allowed them to be read.
     * `PERSISTABLE_QUERY_ROOTS` stays as it is.
     */
    orderDesk: {
        all: () => ['orderDesk'] as const,
        queue: (filter?: QueryScope) => ['orderDesk', 'queue', scope(filter)] as const,
        /**
         * What a basket would come to. Keyed on the whole sale request (shape rule 3), because the
         * quote is a function of *all* of it — the fulfilment type, the customer, the address and
         * every line — and two of those change the total without changing the basket.
         *
         * A cache entry rather than a mutation because it is a **read**: the same basket asked
         * twice is the same answer, the wizard steps back and forth over it, and a `useQuery` is
         * what keeps the last good total on screen while the next one is in flight (a mutation
         * would blank it on every keystroke). It happens to travel by `POST`, which is a fact about
         * the request body's size, not about whether it changes anything.
         */
        quote: (request?: QueryScope) => ['orderDesk', 'quote', scope(request)] as const,
        /**
         * The customer search behind the sale wizard. Keyed on the query text alone: the endpoint
         * takes nothing else, and the org scope is the transport's.
         */
        customers: (query: string) => ['orderDesk', 'customers', query] as const,
        /**
         * The same orders counted by *date* rather than by due-ness.
         *
         * A sibling of `queue` rather than a branch of it, and keyed on the whole filter object per
         * shape rule 3: the range and the branch together are one *view*, so paging back a week is
         * a different entry rather than a mutation of this one — which is what lets the previous
         * week stay in cache while somebody arrows back and forth over a month.
         */
        calendar: (filter?: QueryScope) => ['orderDesk', 'calendar', scope(filter)] as const,
        /**
         * What one branch must buy for a window. Keyed on the whole filter (shape rule 3): the
         * range and the **branch** together are the view, and the branch in particular is not a
         * narrowing of a shared answer — two branches' buy lists are two different documents that
         * happen to look alike, so sharing an entry between them would be the worst possible cache
         * hit.
         */
        requirements: (filter?: QueryScope) =>
            ['orderDesk', 'requirements', scope(filter)] as const,
        /**
         * The hub badge. Keyed on the branch, and on `null` when there is none — the null entry is
         * a real answer (`count: null`, "nobody chose a shelf") rather than an absent one, so it
         * caches like any other.
         */
        shortfallCount: (branchId: string | null) =>
            ['orderDesk', 'shortfall-count', branchId] as const,
        /**
         * The people a run can be given to. No argument, because the endpoint takes none.
         *
         * One entry for the whole workspace: the membership of a kitchen changes on the timescale
         * of employment, so every picker on every screen wants the same answer and none of them
         * wants its own copy.
         */
        drivers: () => ['orderDesk', 'drivers'] as const,
        /**
         * One day's takings. Keyed on the whole filter (shape rule 3): the day and the branch
         * together are the document, and the branch in particular is not a narrowing of a shared
         * answer — a site's takings and the organisation's are two different reconciliations that
         * happen to look alike, so sharing an entry between them would be the worst possible cache
         * hit.
         *
         * Under the desk root and therefore **never persisted**, which matters more here than on the
         * queue: these rows name colleagues and say how much money each of them handled. The root's
         * own note covers it — a tablet the whole kitchen signs into is not where that is written to
         * disk.
         */
        cashReport: (filter?: QueryScope) => ['orderDesk', 'cash-report', scope(filter)] as const,
    },

    /**
     * ── kitchenQuotations: the seller's view of the quotations submitted against this kitchen ────
     * ────────────────────────────────────────────────────────────────────────────────────────────
     *
     * Its own root rather than a branch of `business`, on exactly the terms `kitchenOrders` is not a
     * branch of `commerce` (`api-client/src/contracts/kitchen-quotations.ts`): `business` caches the
     * *buyer's* ask, this caches the *seller's* answer, and pricing a quotation must not evict a
     * buyer's quotation list — nor should a buyer accepting one evict the kitchen's work queue.
     *
     * `list` takes no filter, and the absence is the endpoint's rather than an oversight: the wire
     * offers neither query parameters nor a cursor here, so there is only ever one list to cache.
     * The status filter the screen offers is applied to the rows it already holds.
     *
     * **Never persisted**, on `kitchenOrders`' terms: a quotation is another organisation's
     * negotiated commercial position, held on a tablet the whole kitchen signs into.
     */
    kitchenQuotations: {
        all: () => ['kitchenQuotations'] as const,
        list: () => ['kitchenQuotations', 'list'] as const,
        quotation: (quotationId: QuotationId) =>
            ['kitchenQuotations', 'quotation', quotationId] as const,
    },

    /**
     * ── account: the D2C account area (J1) ──────────────────────────────────────────────────────
     *
     * `overview` and `checklist` are separate entries over overlapping data on purpose. The
     * checklist is what a mutation on any of the five setup screens invalidates — saving an address
     * can flip `canActivate` — while the overview additionally carries the contacts and the account
     * row, which a contact mutation invalidates instead. Giving them one key would make every write
     * refetch both, and giving the checklist no key of its own would make the account screen
     * re-read contacts it is not showing.
     *
     * **Never persisted.** Addresses, an allergy declaration and a consent record are personal
     * data, and the declaration is special-category besides (appendix D). `PERSISTABLE_QUERY_ROOTS`
     * stays as it is.
     */
    account: {
        all: () => ['account'] as const,
        /** Account row, contacts and checklist in one read. */
        overview: () => ['account', 'overview'] as const,
        /** The server's activation evaluator. Never recomputed from the items on the device. */
        checklist: () => ['account', 'checklist'] as const,
        addresses: () => ['account', 'addresses'] as const,
        address: (addressId: string) => ['account', 'address', addressId] as const,
        dietaryProfile: () => ['account', 'dietary-profile'] as const,
        consents: () => ['account', 'consents'] as const,
        /**
         * The closed list of areas an address may point at.
         *
         * Under `account` rather than `reference` despite being non-personal lookup data, because
         * `AccountRepository` is the contract that answers it and the address editor is the only
         * thing that asks. Classifying it as `reference` would additionally make it persistable,
         * and a delivery-area list cached across sessions is a list that can offer an area the
         * platform has since stopped serving — a save refused on a value the screen supplied, which
         * is exactly the kind of stale answer §21 is written to prevent.
         */
        serviceAreas: () => ['account', 'service-areas'] as const,

        /**
         * J2. `closurePreconditions` is re-read on every step of the wizard rather than carried
         * forward from the first one: a subscription created between step two and step four is
         * exactly the case the blocker registry exists to catch, and a wizard holding a snapshot
         * would close over it.
         *
         * `closureRequest` is parameterless because a person has at most one in flight — the
         * backend's partial unique index says so — and because the wizard reads it on mount so a
         * reload lands back on the step it left, with the challenge's cooldown intact.
         */
        closurePreconditions: () => ['account', 'closure', 'preconditions'] as const,
        closureRequest: () => ['account', 'closure', 'request'] as const,
    },

    /**
     * ── verification: contact points and one-time codes (J1) ────────────────────────────────────
     *
     * Its own root rather than a branch of `account` because the OTP framework serves purposes that
     * have no account behind them at all — a guest order, a guest deletion request, a B2B
     * signatory. A key under `account` would make those journeys either invent a second key or
     * invalidate an account they do not have.
     *
     * `challenge` exists so a reload can re-read a live challenge **with its cooldown intact**
     * rather than issue a second one (`contracts/verification.ts`, journey-forced shape 1). It is
     * keyed by the challenge identifier because a resend supersedes: the answer carries a new id,
     * and the old entry must not be reused.
     */
    verification: {
        all: () => ['verification'] as const,
        contacts: () => ['verification', 'contacts'] as const,
        challenge: (challengeId: string) => ['verification', 'challenge', challengeId] as const,
    },

    /**
     * ── guest: ordering without an account (G1) ─────────────────────────────────────────────────
     *
     * Its own root rather than a branch of `commerce`, because everything under it belongs to
     * somebody who has no account and may never have one. Sharing `commerce`'s root would mean a
     * sign-in invalidation either missed the guest entries or wiped a signed-in person's basket.
     *
     * **Never persisted, and this is the strongest case in the file.** A guest orders from a shared
     * laptop, a family tablet, a phone handed over at a counter. The session holds a name, a
     * contact and a delivery address belonging to somebody who *cannot sign in anywhere to clear
     * it* — there is no account to log out of. Writing any of it to disk would leave it for the next
     * person to pick the device up. `PERSISTABLE_QUERY_ROOTS` stays as it is.
     *
     * `order` is keyed by the human reference rather than the identifier because that is what a
     * confirmation page is reached with, and what a person actually holds.
     */
    guest: {
        all: () => ['guest'] as const,
        /** The live guest session behind the stored token — grade, capabilities, contact. */
        session: () => ['guest', 'session'] as const,
        /** A placed order, by its quotable reference. */
        order: (reference: string) => ['guest', 'order', reference] as const,
        /** What the conversion prompt pre-fills from. */
        conversionPrefill: () => ['guest', 'conversion-prefill'] as const,
        /** A live guest passcode challenge, so a reload keeps its cooldown. */
        challenge: (challengeId: string) => ['guest', 'challenge', challengeId] as const,
    },

    /**
     * ── b2bApplication: B2B onboarding (B1) ─────────────────────────────────────────
     *
     * Its own root rather than a branch of `business`, and the reason is a permission boundary
     * rather than tidiness: `business` holds a *corporate buyer's* programme, catalogue and
     * quotations — data that exists only once an organisation does. An applicant has no
     * organisation at all (D-027), so an application cached under `business` would be a personal
     * record filed under a tenant that has not been created yet, and the first thing to invalidate
     * the `business` prefix would throw it away.
     *
     * `current` is parameterless because a person has exactly one live application — the backend's
     * partial unique index says so. The agreement gets an entry of its own because the signing
     * screen re-reads it alone: the digest it echoes back has to be the one the server holds *now*,
     * not one that arrived with an application read five minutes ago.
     *
     * **Never persisted.** A registration number, a signatory's identity document and a set of
     * negotiated commercial terms are all behind this root, and the last of those is confidential
     * to one buyer relationship. `PERSISTABLE_QUERY_ROOTS` stays as it is.
     */
    b2bApplication: {
        all: () => ['b2bApplication'] as const,
        /** The applicant's live application, or `null` when they have never started one. */
        current: () => ['b2bApplication', 'current'] as const,
        agreement: (applicationId: string) =>
            ['b2bApplication', 'agreement', applicationId] as const,

        /**
         * B2. The wind-down, keyed by organisation.
         *
         * Under this root rather than `business` for the reason above inverted: an offboarding is a
         * *relationship* record, not the buying surface, and it must survive the moment the buying
         * surface is revoked. A key under `business` would be thrown away by the first invalidation
         * that follows a revocation — which is precisely when the screen still has to render.
         */
        offboarding: (organisationId: string) =>
            ['b2bApplication', 'offboarding', organisationId] as const,
    },

    /**
     * PA1 — the platform operator's console.
     *
     * The eighteenth root, and it exists rather than hanging off `kitchenAdmin` because the two
     * describe opposite sides of the same word. `kitchenAdmin` is a kitchen's own workspace and is
     * invalidated when that kitchen edits itself; this is a list of *other people's* tenants, and
     * folding it in would mean a platform operator suspending one kitchen threw away the cached
     * catalogue of the kitchen they happen to also work for.
     *
     * Never persisted. It carries owner names and email addresses for organisations the reader does
     * not belong to, which is the clearest case on the list for keeping it in memory only.
     */
    platformAdmin: {
        all: () => ['platformAdmin'] as const,
        kitchens: (filter?: QueryScope) => ['platformAdmin', 'kitchens', scope(filter)] as const,
        kitchen: (kitchen: string) => ['platformAdmin', 'kitchen', kitchen] as const,
    },

    /**
     * The token-scoped invitation read (PA1).
     *
     * **Keyed by the token**, which is the only thing that identifies it — the invitation's own id
     * arrives *in* the response and is therefore useless as a key. That makes this the one key in
     * this file that contains a credential, which is precisely why the root is absent from
     * `PERSISTED_QUERY_ROOTS` below: a bearer-ish token must not reach disk, least of all on the
     * shared device somebody opened a colleague's forwarded link on.
     */
    invitations: {
        all: () => ['invitations'] as const,
        byToken: (token: string) => ['invitations', 'token', token] as const,
    },

    /**
     * ── driverJobs: one driver's run sheet ──────────────────────────────────────────────────────
     * ────────────────────────────────────────────────────────────────────────────────────────────
     *
     * Added whole by the Order Desk delivery-chain wave, which owns this file's change for that
     * slice — the header's rule is that a later wave asks rather than edits, and this is the wave
     * that was asked.
     *
     * Its own root rather than a branch of `kitchenOrders` for the reason
     * `api-client/src/contracts/driver-jobs.ts` gives: those are the seller's *orders* and these are
     * *delivery jobs* — a different table, a different module and a two-axis status the order shape
     * has no room for. They also invalidate on opposite events. A driver stamping a job delivered
     * must not evict the kitchen's order book off a tablet somebody is working, and a kitchen
     * confirming an order must not throw away the run sheet in a driver's pocket.
     *
     * One entry and no parameters, because the endpoint has none: no cursor, no filters, and the
     * narrowing is `driver_user_id = me` rather than anything a key could carry. `all()` exists so
     * the deliver mutation has a prefix to invalidate, which is the same prefix — kept anyway so
     * the invalidation reads like every other one in this file rather than like a special case.
     *
     * **Never persisted.** A run sheet is a list of live deliveries — where somebody's food is
     * going, right now — held on a phone that travels, gets left in a car and changes hands between
     * shifts. `PERSISTABLE_QUERY_ROOTS` stays as it is.
     */
    driverJobs: {
        all: () => ['driverJobs'] as const,
        list: () => ['driverJobs', 'list'] as const,
    },
} as const;

/**
 * Roots whose cached data may survive a restart.
 *
 * Deliberately minimal (plan §21). `session`, `devices`, `nutrition`, `planner`, `vd`, `commerce`,
 * `business`, `professional`, `kitchenAdmin`, `account` and `verification` are absent and must stay
 * absent: they are authentication responses, personal data, medical-adjacent data, or — in
 * `kitchenAdmin`'s case — confidential commercial data on a device several people share. `account`
 * additionally holds a special-category allergy declaration and a consent record, and
 * `verification` holds live one-time-code state whose whole security model is that it is
 * short-lived. `guest` is the newest absence and the least negotiable one: it holds a name, a
 * contact and a delivery address belonging to somebody with no account to sign out of, frequently
 * on a device that is not theirs. Adding a root here is a privacy decision, which is why it is a
 * single reviewable list rather than a per-query flag. `platformAdmin` (PA1) is absent on the
 * clearest grounds of any of them: it holds the names and email addresses of the owners of
 * organisations the reader does not belong to. `kitchenOrders` is absent on both grounds at once —
 * a kitchen's order book is commercial data *and* a list of named customers' delivery addresses,
 * held on a tablet the whole kitchen signs into. `orderDesk` is absent for the same reason and one
 * step further out: its rows carry customers' names and telephone numbers, served only to a caller
 * holding `order.view_customer_contact_organisation`, and a cache on disk would outlive both the
 * session and the permission that allowed them to be read.
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

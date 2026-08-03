import { PLAN_DURATION_WEEKS, money } from '@healthy360/domain-types';
import type {
    CartId,
    CorporateProgrammeId,
    DietitianId,
    IsoDateTime,
    KitchenId,
    MealId,
    MealPlanEntryId,
    MealPlanId,
    MealType,
    NutritionTargetId,
    RecipeId,
    SubscriptionId,
    SubscriptionPlanId,
    UserId,
    VdSessionId,
    VdSessionState,
} from '@healthy360/domain-types';
import { scaleFacts } from '@healthy360/nutrition';
import type {
    NutrientTarget,
    NutritionFacts,
    NutritionTargetRequest,
    NutritionTargetResult,
} from '@healthy360/nutrition';

import type {
    CatalogueItem,
    CorporateProgramme,
    Quotation,
    RequestQuotationRequest,
} from '../../contracts/business.ts';
import type {
    Cart,
    CartItem,
    ChangeAddressRequest,
    ChangeSlotRequest,
    CheckoutPreview,
    CreateSubscriptionRequest,
    DeliveryAddress,
    DeliverySlot,
    PauseSubscriptionRequest,
    PlaceOrderRequest,
    PlacedOrder,
    PlacedOrderLine,
    PreviewCheckoutRequest,
    PriceLine,
    SkipDayRequest,
    Subscription,
    SubscriptionConfiguration,
    SubscriptionPreview,
} from '../../contracts/commerce.ts';
import { apiFailure, throwFailure, validationFailure } from '../../contracts/failure.ts';
import type { Food, GroceryList, Pantry, Recipe } from '../../contracts/foods.ts';
import type { Kitchen, MarketplaceMeal, SubscriptionPlan } from '../../contracts/marketplace.ts';
import type {
    NutritionReview,
    RequestNutritionReviewRequest,
    StoredNutritionTarget,
    UpdateNutritionTargetRequest,
} from '../../contracts/nutrition.ts';
import type {
    AddEntryRequest,
    AdjustPortionRequest,
    DuplicatePlanRequest,
    GeneratePlanRequest,
    MealPlanDay,
    MealPlanEntry,
    MealPlanState,
    MealPlanSummary,
    MealPlanWeek,
    PlanHistoryAction,
    PlanHistoryEvent,
    PlanNotes,
    RegenerateScopeRequest,
    RepeatMealRequest,
    ReplaceEntryRequest,
    SaveTemplateRequest,
    SetPlanNotesRequest,
} from '../../contracts/planner.ts';
import type {
    ApproveReviewRequest,
    DietitianNote,
    RequestChangesRequest,
    ReviewDetail,
    ReviewQueueItem,
    SetDietitianNoteRequest,
    SetOverrideRequest,
} from '../../contracts/professional.ts';
import type {
    AcceptVdProposalRequest,
    CreateVdSessionRequest,
    GenerateVdDraftRequest,
    OverrideVdProposalRequest,
    RequestVdReviewRequest,
    SendVdMessageRequest,
    VdMessage,
    VdSession,
} from '../../contracts/virtual-dietitian.ts';
import type { MockScenarioName } from '../scenarios.ts';
import {
    PROTOTYPE_NOW,
    PROTOTYPE_TODAY,
    PROTOTYPE_WEEK_START,
    SYNTHETIC_SOURCE_LABEL,
    addDays,
    aed,
    daysBetween,
    isoWeekday,
    rotate,
} from './constants.ts';
import {
    ALLERGEN_WARNING_CODE,
    PROTOTYPE_CATALOGUE_ITEMS,
    PROTOTYPE_CLIENT_NOTE,
    PROTOTYPE_CONSTRAINTS,
    PROTOTYPE_CUSTOMER_ID,
    PROTOTYPE_CUSTOMER_NAME,
    PROTOTYPE_DIETITIAN_NOTE,
    PROTOTYPE_MEALS,
    PROTOTYPE_PANTRY,
    PROTOTYPE_PLAN_IDS,
    PROTOTYPE_QUOTATIONS,
    PROTOTYPE_REVIEW_CONTEXT,
    PROTOTYPE_REVIEW_QUEUE,
    PROTOTYPE_STORED_TARGET,
    PROTOTYPE_TARGET_ENGINE,
    PROTOTYPE_VD_SESSIONS,
    PROTOTYPE_WEEK_ENTRIES,
    QUOTATION_REFERENCE_PREFIX,
    VD_ASSISTANT_SCRIPT,
    VD_DISCLAIMER,
    VD_ESCALATION_NOTICE,
    VD_MISSING_INFORMATION_FIXTURES,
    VD_PROGRESSION,
    allergenCode,
    buildDay,
    buildGroceryList,
    buildWeek,
    catalogueItemById,
    compareEntries,
    detectSafetyMarker,
    makeEntry,
    makeVdMessage,
    makeVdProposal,
    makeVdSession,
    makeWeekEntries,
    nutrientTargetsFor,
    planByKey,
    programmeById,
    targetFactsFor,
} from './fixtures/index.ts';
import { KitchenCatalogueStore } from './catalogue-store.ts';
import {
    PROTOTYPE_RUNTIME_ORDINAL_START,
    cartIdAt,
    mealPlanEntryIdAt,
    mealPlanIdAt,
    orderIdAt,
    quotationIdAt,
    subscriptionIdAt,
    vdSessionIdAt,
} from './ids.ts';

/**
 * The mutable prototype world.
 *
 * Same shape as `../store.ts`: a plain class, every method synchronous and total, every rejection
 * through `throwFailure`. The repository layer above adds latency and the public contract and
 * nothing else, which is what keeps the mock and the future API repository indistinguishable to a
 * screen.
 *
 * ## Why so much of this genuinely mutates
 *
 * The prompt forbids dead controls. The alternative to real mutation is a toast saying "not built
 * yet" on every button, which is a prototype nobody can evaluate. So everything the fixture world
 * can honestly support — locking, regeneration at three scopes, replacement, portions, repeats, the
 * cart, subscription pause and skip, the Virtual Dietitian progression, professional approval and
 * override — changes state here and is visible on the next read. Only genuinely absent capabilities
 * (payment, printing, export) stay unimplemented, and those belong to the application's
 * `usePrototypeAction()`, not to this file.
 *
 * ## Not-found
 *
 * `resource.not_found` entered the failure vocabulary with K1, and the **kitchen-management** paths
 * (`./catalogue-store.ts`) use it. The *consumer* paths below deliberately still reject as `server`
 * with a sentence naming what was missing. That is not an oversight: the consumer screens' empty and
 * error states were built against that behaviour, the API repositories behind them are still
 * unimplemented stubs, and changing what a marketplace 404 looks like belongs to M1's per-family
 * switch — with its own screens, copy and Playwright pass — not to a refactor whose whole promise is
 * that nothing a consumer sees changes.
 *
 * ## The catalogue
 *
 * Ingredients, recipes, products, price lists, meals, plans, zones and branch operating data live in
 * {@link KitchenCatalogueStore}, held here as `kitchenCatalogue`. The consumer reads on this class delegate
 * to it, which is the point: a kitchen manager who retires a meal removes it from the marketplace
 * listing, because there is only one collection and both sides read it.
 */

/** Delivery slots the prototype offers. Codes are stable; the labels are translated by the app. */
export const PROTOTYPE_DELIVERY_SLOTS: readonly DeliverySlot[] = [
    { code: 'morning', label: 'Morning', startsAt: '07:00', endsAt: '10:00' },
    { code: 'midday', label: 'Midday', startsAt: '11:00', endsAt: '14:00' },
    { code: 'evening', label: 'Evening', startsAt: '17:00', endsAt: '21:00' },
];

export const PROTOTYPE_DELIVERY_FEE_FILS = 1200;
export const PROTOTYPE_FREE_DELIVERY_THRESHOLD_FILS = 15000;

/** The delivery address the seeded subscription starts on. */
export const PROTOTYPE_ADDRESS: DeliveryAddress = {
    label: 'Home',
    line1: 'Apartment 1402, Bay Tower',
    line2: null,
    area: 'Business Bay',
    city: 'Dubai',
    countryCode: 'AE',
    instructions: 'Leave with the concierge if there is no answer.',
};

/** Scenarios that start before onboarding has produced anything. */
const ONBOARDING_SCENARIOS: ReadonlySet<string> = new Set(['consumer-onboarding']);

/**
 * Warnings a person may confirm away.
 *
 * `planner.allergen_conflict` is deliberately absent and will stay absent:
 * `ReplaceEntryRequest.confirmedWarnings` exists for the `user_confirmed` constraints in
 * `@healthy360/nutrition`, and honouring it for an allergy would turn a safety filter into a nag
 * screen somebody learns to dismiss.
 */
const CONFIRMABLE_WARNINGS: ReadonlySet<string> = new Set([
    'planner.energy_out_of_range',
    'planner.macros_out_of_range',
    'planner.prohibited_ingredient',
    'planner.diet_conflict',
    'planner.over_budget',
]);

interface MutablePlan {
    readonly id: MealPlanId;
    readonly userId: UserId;
    name: string | null;
    state: MealPlanState;
    weekStart: string;
    entries: MealPlanEntry[];
    customerNote: string | null;
    notesUpdatedAt: IsoDateTime | null;
    history: PlanHistoryEvent[];
    generatedAt: IsoDateTime | null;
    updatedAt: IsoDateTime;
}

interface MutableCart {
    readonly id: CartId;
    items: CartItem[];
    updatedAt: IsoDateTime;
}

interface TargetProjection {
    readonly targets: readonly NutrientTarget[];
    readonly daily: NutritionFacts | null;
    readonly weekly: NutritionFacts | null;
}

export interface PrototypeStoreOptions {
    readonly scenario?: MockScenarioName | undefined;
    /** Overrides the scenario default. Used by tests that want an empty planner explicitly. */
    readonly onboardingComplete?: boolean | undefined;
}

export class PrototypeStore {
    readonly scenario: string;
    readonly onboardingComplete: boolean;

    /**
     * The mutable kitchen catalogue, shared by the management surface and every consumer read.
     *
     * A field rather than a base class: the planner, the cart and the Virtual Dietitian have nothing
     * to do with catalogue management, and folding nine hundred lines of it into this file would
     * make both halves harder to review than the one delegation below costs.
     */
    readonly kitchenCatalogue = new KitchenCatalogueStore();

    readonly #plans = new Map<string, MutablePlan>();
    readonly #carts = new Map<string, MutableCart>();
    /** Placed one-off orders, by the reference a confirmation screen quotes. */
    readonly #orders = new Map<string, PlacedOrder>();
    readonly #subscriptions = new Map<string, Subscription>();
    readonly #sessions = new Map<string, VdSession>();
    readonly #reviews = new Map<string, ReviewQueueItem>();
    readonly #dietitianNotes = new Map<string, DietitianNote>();
    readonly #rotation = new Map<string, number>();
    #quotations: Quotation[] = [];
    #nutritionReviews: NutritionReview[] = [];
    #target: StoredNutritionTarget | null = null;
    #pantry: Pantry = PROTOTYPE_PANTRY;
    #currentCartId: CartId | null = null;

    #nextEntryOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;
    #nextSessionOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;
    #nextMessageOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;
    #nextSubscriptionOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;
    #nextOrderOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;
    #nextQuotationOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;
    #nextPlanOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;
    #historyOrdinal = 0;

    constructor(options: PrototypeStoreOptions = {}) {
        this.scenario = options.scenario ?? 'consumer-prototype';
        this.onboardingComplete =
            options.onboardingComplete ?? !ONBOARDING_SCENARIOS.has(this.scenario);
        this.#seed();
    }

    #seed(): void {
        if (!this.onboardingComplete) {
            // Before onboarding there is no target, no week and nothing to review. The planner's
            // empty state is a real state, not a loading artefact, so it gets a real world.
            this.#plans.set(PROTOTYPE_PLAN_IDS.week, {
                id: PROTOTYPE_PLAN_IDS.week,
                userId: PROTOTYPE_CUSTOMER_ID,
                name: null,
                state: 'draft',
                weekStart: PROTOTYPE_WEEK_START,
                entries: [],
                customerNote: null,
                notesUpdatedAt: null,
                history: [],
                generatedAt: null,
                updatedAt: PROTOTYPE_NOW,
            });
            return;
        }

        this.#target = PROTOTYPE_STORED_TARGET;

        this.#plans.set(PROTOTYPE_PLAN_IDS.week, {
            id: PROTOTYPE_PLAN_IDS.week,
            userId: PROTOTYPE_CUSTOMER_ID,
            name: 'This week',
            state: 'active',
            weekStart: PROTOTYPE_WEEK_START,
            entries: [...PROTOTYPE_WEEK_ENTRIES],
            customerNote: PROTOTYPE_CLIENT_NOTE,
            notesUpdatedAt: PROTOTYPE_NOW,
            history: [
                this.#event(PROTOTYPE_PLAN_IDS.week, 'generated', 'system', 'Week generated.', {
                    at: '2026-07-26T18:00:00.000Z',
                }),
                this.#event(
                    PROTOTYPE_PLAN_IDS.week,
                    'entry_locked',
                    'customer',
                    'Monday dinner locked.',
                    { at: '2026-07-26T18:04:00.000Z' },
                ),
                this.#event(
                    PROTOTYPE_PLAN_IDS.week,
                    'professionally_approved',
                    'dietitian',
                    'Thursday dinner approved by Layla Haddad.',
                    { at: '2026-07-26T11:15:00.000Z' },
                ),
            ],
            generatedAt: '2026-07-26T18:00:00.000Z',
            updatedAt: PROTOTYPE_NOW,
        });

        for (const session of PROTOTYPE_VD_SESSIONS) this.#sessions.set(session.id, session);
        for (const item of PROTOTYPE_REVIEW_QUEUE) this.#reviews.set(item.id, item);
        this.#dietitianNotes.set(PROTOTYPE_PLAN_IDS.week, PROTOTYPE_DIETITIAN_NOTE);
        this.#quotations = [...PROTOTYPE_QUOTATIONS];
        this.#seedSubscription();
    }

    #seedSubscription(): void {
        const plan = planByKey('balanced_week');
        const variant = plan.variants[1] ?? plan.variants[0];
        if (variant === undefined) return;

        const id = subscriptionIdAt(0);
        this.#subscriptions.set(id, {
            id,
            state: 'active',
            configuration: {
                planId: plan.id,
                variantId: variant.id,
                duration: '4w',
                startDate: PROTOTYPE_WEEK_START,
                deliveryWeekdays: [1, 3, 5],
                slotCode: 'midday',
                address: PROTOTYPE_ADDRESS,
                dietClassifications: ['mediterranean'],
                excludeAllergens: PROTOTYPE_CONSTRAINTS.filter(
                    (constraint) => constraint.kind === 'allergy',
                ).map((constraint) => allergenCode(constraint.code)),
                selectedMealIds: [],
            },
            planName: plan.name,
            kitchenId: plan.kitchenId,
            weeklyPrice: variant.pricePerWeek,
            nextDeliveryDate: addDays(PROTOTYPE_TODAY, 1),
            skippedDates: [],
            pausedUntil: null,
            createdAt: '2026-07-26T18:10:00.000Z',
            updatedAt: PROTOTYPE_NOW,
        });
    }

    /* ── target projection ─────────────────────────────────────────────────────────────────── */

    /**
     * The planner's target bands.
     *
     * Projected from the stored target on every read rather than cached, so a professional override
     * moves the planner's meters in the same breath as it changes the nutrition page. With no stored
     * target — before onboarding — there are no bands at all, and a day renders against nothing
     * rather than against somebody else's numbers.
     */
    #projection(): TargetProjection {
        if (this.#target === null) return { targets: [], daily: null, weekly: null };
        const targets = nutrientTargetsFor(this.#target.result);
        return {
            targets,
            daily: targetFactsFor(targets),
            weekly: targetFactsFor(targets, 7),
        };
    }

    /* ── plans ─────────────────────────────────────────────────────────────────────────────── */

    #plan(planId: MealPlanId): MutablePlan {
        const plan = this.#plans.get(planId);
        if (plan === undefined) {
            throwFailure(
                apiFailure('server', {
                    message: `No meal plan ${String(planId)} exists in this world.`,
                    retryable: false,
                }),
            );
        }
        return plan;
    }

    #entry(plan: MutablePlan, entryId: MealPlanEntryId): MealPlanEntry {
        const entry = plan.entries.find((candidate) => candidate.id === entryId);
        if (entry === undefined) {
            throwFailure(
                apiFailure('server', {
                    message: `No planner entry ${String(entryId)} on plan ${String(plan.id)}.`,
                    retryable: false,
                }),
            );
        }
        return entry;
    }

    #event(
        planId: MealPlanId,
        action: PlanHistoryAction,
        actor: PlanHistoryEvent['actor'],
        summary: string,
        options: {
            readonly at?: IsoDateTime | undefined;
            readonly entryId?: MealPlanEntryId | null | undefined;
            readonly date?: string | null | undefined;
        } = {},
    ): PlanHistoryEvent {
        this.#historyOrdinal += 1;
        return {
            id: `${String(planId)}-h${String(this.#historyOrdinal).padStart(3, '0')}`,
            planId,
            action,
            at: options.at ?? PROTOTYPE_NOW,
            actor,
            summary,
            entryId: options.entryId ?? null,
            date: options.date ?? null,
        };
    }

    #record(
        plan: MutablePlan,
        action: PlanHistoryAction,
        actor: PlanHistoryEvent['actor'],
        summary: string,
        options: {
            readonly entryId?: MealPlanEntryId | null | undefined;
            readonly date?: string | null | undefined;
        } = {},
    ): void {
        plan.history = [this.#event(plan.id, action, actor, summary, options), ...plan.history];
        plan.updatedAt = PROTOTYPE_NOW;
    }

    #store(plan: MutablePlan, entry: MealPlanEntry): void {
        plan.entries = plan.entries.map((candidate) =>
            candidate.id === entry.id ? entry : candidate,
        );
    }

    getWeek(planId: MealPlanId, weekStart: string): MealPlanWeek {
        const plan = this.#plan(planId);
        const projection = this.#projection();
        return buildWeek(plan.id, weekStart, plan.entries, {
            userId: plan.userId,
            state: plan.state,
            generatedAt: plan.generatedAt,
            updatedAt: plan.updatedAt,
            targets: projection.targets,
            targetFacts: projection.daily,
            weeklyTargetFacts: projection.weekly,
        });
    }

    getDay(planId: MealPlanId, date: string): MealPlanDay {
        const plan = this.#plan(planId);
        const projection = this.#projection();
        return buildDay(plan.id, date, plan.entries, {
            targets: projection.targets,
            targetFacts: projection.daily,
        });
    }

    listPlans(): readonly MealPlanSummary[] {
        return [...this.#plans.values()].map((plan) => ({
            planId: plan.id,
            name: plan.name,
            state: plan.state,
            weekStart: plan.weekStart,
            updatedAt: plan.updatedAt,
        }));
    }

    /**
     * Generation.
     *
     * Deterministic, and honest about what it is: the fixture week re-seeded against the requested
     * Monday, with locked entries for that same week preserved. There is no solver here —
     * `@healthy360/nutrition` declares the constraints and preferences a real planner must respect
     * and deliberately ships no search, so inventing one inside a fixture store would be the worst
     * kind of prototype: convincing, and wrong.
     */
    generate(request: GeneratePlanRequest): MealPlanWeek {
        const planId = PROTOTYPE_PLAN_IDS.week;
        const existing = this.#plans.get(planId);
        const projection = this.#projection();
        const generated = makeWeekEntries({
            planId,
            weekStart: request.weekStart,
            targets: projection.targets,
        });

        // Locks survive a regeneration of the *same* week. A different week is a different week:
        // keeping an entry across it would produce two entries with one identifier.
        const kept =
            existing !== undefined && existing.weekStart === request.weekStart
                ? existing.entries.filter((entry) => entry.locked)
                : [];
        const keptSlots = new Set(kept.map((entry) => `${entry.date}:${entry.mealType}`));

        const plan: MutablePlan = {
            id: planId,
            userId: PROTOTYPE_CUSTOMER_ID,
            name: existing?.name ?? 'This week',
            state: 'active',
            weekStart: request.weekStart,
            entries: [
                ...kept,
                ...generated.filter((entry) => !keptSlots.has(`${entry.date}:${entry.mealType}`)),
            ].sort(compareEntries),
            customerNote: existing?.customerNote ?? null,
            notesUpdatedAt: existing?.notesUpdatedAt ?? null,
            history: existing?.history ?? [],
            generatedAt: PROTOTYPE_NOW,
            updatedAt: PROTOTYPE_NOW,
        };

        this.#plans.set(planId, plan);
        this.#record(plan, 'generated', 'system', `Week of ${request.weekStart} generated.`, {
            date: request.weekStart,
        });
        return this.getWeek(planId, request.weekStart);
    }

    /* ── regeneration ──────────────────────────────────────────────────────────────────────── */

    #candidates(mealType: MealType, request?: RegenerateScopeRequest): readonly MealId[] {
        const excluded = new Set<string>(request?.excludeMealIds ?? []);
        const candidates = PROTOTYPE_MEALS.filter(
            (meal) => meal.mealTypes.includes(mealType) && !excluded.has(meal.id),
        ).map((meal) => meal.id);

        if (candidates.length === 0) {
            throwFailure(
                apiFailure('server', {
                    message: `Nothing is offered for ${mealType} once the exclusions are applied.`,
                    retryable: false,
                }),
            );
        }
        return candidates;
    }

    /**
     * The next candidate for an entry.
     *
     * A rotation, not a random draw: regenerating the same entry twice gives two *different* meals,
     * and the sequence is identical on every run. A prototype whose regenerate button sometimes
     * returns the same thing is indistinguishable from one whose regenerate button is broken.
     */
    #rotateEntry(entry: MealPlanEntry, request?: RegenerateScopeRequest): MealPlanEntry {
        const candidates = this.#candidates(entry.mealType, request);
        const stored = this.#rotation.get(entry.id);
        const current =
            stored ??
            (entry.mealId === null
                ? -1
                : candidates.findIndex((candidate) => candidate === entry.mealId));
        const next = current + 1;
        this.#rotation.set(entry.id, next);

        return makeEntry({
            id: entry.id,
            planId: entry.planId,
            date: entry.date,
            mealType: entry.mealType,
            kind: 'kitchen_meal',
            position: entry.position,
            mealId: rotate(candidates, next, 'candidate meal'),
            portionFactor: entry.portionFactor,
            targets: this.#projection().targets,
        });
    }

    regenerateEntry(
        planId: MealPlanId,
        entryId: MealPlanEntryId,
        request?: RegenerateScopeRequest,
    ): MealPlanEntry {
        const plan = this.#plan(planId);
        const entry = this.#entry(plan, entryId);
        if (entry.locked) {
            throwFailure(
                validationFailure({
                    entry: ['This entry is locked. Unlock it before regenerating it.'],
                }),
            );
        }
        const replacement = this.#rotateEntry(entry, request);
        this.#store(plan, replacement);
        this.#record(plan, 'entry_regenerated', 'customer', `${replacement.label} suggested.`, {
            entryId,
            date: entry.date,
        });
        return replacement;
    }

    regenerateDay(planId: MealPlanId, date: string, request?: RegenerateScopeRequest): MealPlanDay {
        const plan = this.#plan(planId);
        for (const entry of plan.entries.filter(
            (candidate) => candidate.date === date && !candidate.locked,
        )) {
            this.#store(plan, this.#rotateEntry(entry, request));
        }
        this.#record(plan, 'day_regenerated', 'customer', `${date} regenerated.`, { date });
        return this.getDay(planId, date);
    }

    regenerateWeek(planId: MealPlanId, request?: RegenerateScopeRequest): MealPlanWeek {
        const plan = this.#plan(planId);
        for (const entry of plan.entries.filter((candidate) => !candidate.locked)) {
            this.#store(plan, this.#rotateEntry(entry, request));
        }
        this.#record(plan, 'week_regenerated', 'customer', 'Whole week regenerated.', {
            date: plan.weekStart,
        });
        return this.getWeek(planId, plan.weekStart);
    }

    /* ── locking, replacement, portions ────────────────────────────────────────────────────── */

    lockEntry(planId: MealPlanId, entryId: MealPlanEntryId): MealPlanEntry {
        return this.#setLock(planId, entryId, true);
    }

    unlockEntry(planId: MealPlanId, entryId: MealPlanEntryId): MealPlanEntry {
        return this.#setLock(planId, entryId, false);
    }

    #setLock(planId: MealPlanId, entryId: MealPlanEntryId, locked: boolean): MealPlanEntry {
        const plan = this.#plan(planId);
        const entry = this.#entry(plan, entryId);
        const updated: MealPlanEntry = { ...entry, locked };
        this.#store(plan, updated);
        this.#record(
            plan,
            locked ? 'entry_locked' : 'entry_unlocked',
            'customer',
            `${entry.label} ${locked ? 'locked' : 'unlocked'}.`,
            { entryId, date: entry.date },
        );
        return updated;
    }

    replaceEntry(
        planId: MealPlanId,
        entryId: MealPlanEntryId,
        request: ReplaceEntryRequest,
    ): readonly MealPlanEntry[] {
        const plan = this.#plan(planId);
        const entry = this.#entry(plan, entryId);
        const targets = this.#projection().targets;

        const affected = [entry];
        if (request.mode === 'recurring') {
            // "Every future occurrence" means the same slot on later days — which is what a person
            // means by a recurring meal, not every entry that happens to share a label.
            for (const candidate of plan.entries) {
                if (
                    candidate.id !== entry.id &&
                    candidate.mealType === entry.mealType &&
                    candidate.date > entry.date &&
                    candidate.label === entry.label &&
                    !candidate.locked
                ) {
                    affected.push(candidate);
                }
            }
        }

        const replaced = affected.map((target) => {
            const next = makeEntry({
                id: target.id,
                planId: target.planId,
                date: target.date,
                mealType: target.mealType,
                kind: request.kind,
                position: target.position,
                ...(request.mealId === undefined ? {} : { mealId: request.mealId }),
                ...(request.recipeId === undefined ? {} : { recipeId: request.recipeId }),
                ...(request.restaurantName === undefined
                    ? {}
                    : { restaurantName: request.restaurantName }),
                ...(request.label === undefined ? {} : { label: request.label }),
                portionFactor: request.portionFactor ?? target.portionFactor,
                ...(request.confirmedWarnings === undefined
                    ? {}
                    : {
                          suppressWarnings: request.confirmedWarnings.filter((code) =>
                              CONFIRMABLE_WARNINGS.has(code),
                          ),
                      }),
                targets,
            });
            this.#store(plan, next);
            return next;
        });

        this.#record(
            plan,
            'entry_replaced',
            'customer',
            request.mode === 'recurring'
                ? `Replaced ${String(replaced.length)} occurrences.`
                : `Replaced ${entry.label}.`,
            { entryId, date: entry.date },
        );
        return replaced;
    }

    /**
     * Portion adjustment.
     *
     * Scales the entry that is already there rather than rebuilding it from its source. That is not
     * a shortcut: it is the only way a `food` entry, a restaurant estimate and a kitchen meal can
     * all be adjusted by the same code path, and it keeps the figures on screen consistent with the
     * ones the entry was created with.
     */
    adjustPortion(
        planId: MealPlanId,
        entryId: MealPlanEntryId,
        request: AdjustPortionRequest,
    ): MealPlanEntry {
        if (!Number.isFinite(request.portionFactor) || request.portionFactor <= 0) {
            throwFailure(
                validationFailure({ portion_factor: ['A portion must be greater than zero.'] }),
            );
        }
        const plan = this.#plan(planId);
        const entry = this.#entry(plan, entryId);
        const ratio = request.portionFactor / entry.portionFactor;

        const nutrition = scaleFacts(entry.nutrition, ratio, {
            basis: 'per_meal',
            method: 'planner.portion_adjusted',
        });

        const updated: MealPlanEntry = {
            ...entry,
            portionFactor: request.portionFactor,
            nutrition,
            estimatedCost:
                entry.estimatedCost === null
                    ? null
                    : money(
                          Math.round(entry.estimatedCost.amount * ratio),
                          entry.estimatedCost.currency,
                      ),
            warnings: deriveWarningsFor(entry.allergens, nutrition, this.#projection().targets),
        };

        this.#store(plan, updated);
        this.#record(
            plan,
            'portion_adjusted',
            'customer',
            `${entry.label} set to ${String(request.portionFactor)} of a portion.`,
            { entryId, date: entry.date },
        );
        return updated;
    }

    /* ── adding, removing, repeating ───────────────────────────────────────────────────────── */

    addEntry(planId: MealPlanId, request: AddEntryRequest): MealPlanEntry {
        const plan = this.#plan(planId);
        this.#nextEntryOrdinal += 1;
        const id = mealPlanEntryIdAt(this.#nextEntryOrdinal);

        const entry = makeEntry({
            id,
            planId,
            date: request.date,
            mealType: request.mealType,
            kind: request.kind,
            position:
                request.position ??
                plan.entries.filter(
                    (candidate) =>
                        candidate.date === request.date && candidate.mealType === request.mealType,
                ).length,
            ...(request.mealId === undefined ? {} : { mealId: request.mealId }),
            ...(request.recipeId === undefined ? {} : { recipeId: request.recipeId }),
            ...(request.foodId === undefined ? {} : { foodId: request.foodId }),
            ...(request.grams === undefined ? {} : { grams: request.grams }),
            ...(request.restaurantName === undefined
                ? {}
                : { restaurantName: request.restaurantName }),
            ...(request.label === undefined ? {} : { label: request.label }),
            portionFactor: request.portionFactor ?? 1,
            targets: this.#projection().targets,
        });

        plan.entries = [...plan.entries, entry].sort(compareEntries);
        this.#record(plan, 'entry_added', 'customer', `${entry.label} added.`, {
            entryId: id,
            date: request.date,
        });
        return entry;
    }

    removeEntry(planId: MealPlanId, entryId: MealPlanEntryId): void {
        const plan = this.#plan(planId);
        const entry = this.#entry(plan, entryId);
        plan.entries = plan.entries.filter((candidate) => candidate.id !== entryId);
        this.#record(plan, 'entry_removed', 'customer', `${entry.label} removed.`, {
            entryId,
            date: entry.date,
        });
    }

    repeatMeal(planId: MealPlanId, request: RepeatMealRequest): readonly MealPlanEntry[] {
        const plan = this.#plan(planId);
        const entry = this.#entry(plan, request.entryId);
        const created: MealPlanEntry[] = [];

        for (const date of request.dates) {
            this.#nextEntryOrdinal += 1;
            const copy: MealPlanEntry = {
                ...entry,
                id: mealPlanEntryIdAt(this.#nextEntryOrdinal),
                date,
                mealType: request.mealType ?? entry.mealType,
                locked: false,
                isLeftover: request.asLeftovers === true,
                leftoverOfEntryId: request.asLeftovers === true ? entry.id : null,
                // A copy is not the entry a dietitian signed off.
                approvedBy: null,
            };
            plan.entries = [...plan.entries, copy];
            created.push(copy);
        }

        plan.entries = plan.entries.slice().sort(compareEntries);
        this.#record(
            plan,
            'meal_repeated',
            'customer',
            `${entry.label} repeated on ${String(request.dates.length)} day(s).`,
            { entryId: entry.id, date: entry.date },
        );
        return created;
    }

    /* ── notes, history, templates ─────────────────────────────────────────────────────────── */

    getNotes(planId: MealPlanId): PlanNotes {
        const plan = this.#plan(planId);
        return {
            planId,
            customerNote: plan.customerNote,
            dietitianNote: this.#dietitianNotes.get(planId)?.note ?? null,
            updatedAt: plan.notesUpdatedAt,
        };
    }

    setNotes(planId: MealPlanId, request: SetPlanNotesRequest): PlanNotes {
        const plan = this.#plan(planId);
        plan.customerNote = request.customerNote;
        plan.notesUpdatedAt = PROTOTYPE_NOW;
        this.#record(plan, 'notes_updated', 'customer', 'Plan notes updated.');
        return this.getNotes(planId);
    }

    history(planId: MealPlanId): readonly PlanHistoryEvent[] {
        return [...this.#plan(planId).history];
    }

    saveAsTemplate(planId: MealPlanId, request: SaveTemplateRequest): MealPlanSummary {
        const source = this.#plan(planId);
        const templateId = PROTOTYPE_PLAN_IDS.template;
        this.#plans.set(templateId, {
            id: templateId,
            userId: source.userId,
            name: request.name,
            state: 'template',
            weekStart: source.weekStart,
            entries: source.entries.map((entry) => ({ ...entry, planId: templateId })),
            customerNote: null,
            notesUpdatedAt: null,
            history: [],
            generatedAt: source.generatedAt,
            updatedAt: PROTOTYPE_NOW,
        });

        return {
            planId: templateId,
            name: request.name,
            state: 'template',
            weekStart: source.weekStart,
            updatedAt: PROTOTYPE_NOW,
        };
    }

    duplicate(planId: MealPlanId, request: DuplicatePlanRequest): MealPlanWeek {
        const source = this.#plan(planId);
        this.#nextPlanOrdinal += 1;
        const copyId = mealPlanIdAt(this.#nextPlanOrdinal);
        const shift = daysBetween(source.weekStart, request.weekStart);

        const entries = source.entries.map((entry, index) => ({
            ...entry,
            id: mealPlanEntryIdAt(this.#nextEntryOrdinal + index + 1),
            planId: copyId,
            date: addDays(entry.date, shift),
        }));
        this.#nextEntryOrdinal += entries.length;

        this.#plans.set(copyId, {
            id: copyId,
            userId: source.userId,
            name: source.name,
            state: 'draft',
            weekStart: request.weekStart,
            entries,
            customerNote: request.includeNotes === true ? source.customerNote : null,
            notesUpdatedAt: request.includeNotes === true ? source.notesUpdatedAt : null,
            history: [],
            generatedAt: PROTOTYPE_NOW,
            updatedAt: PROTOTYPE_NOW,
        });

        return this.getWeek(copyId, request.weekStart);
    }

    /* ── foods, recipes, grocery, pantry ───────────────────────────────────────────────────── */

    foods(): readonly Food[] {
        return this.kitchenCatalogue.consumerIngredients().map((ingredient) => ({
            id: ingredient.id,
            name: ingredient.name,
            brand: null,
            per100g: ingredient.per100g,
            servings: ingredient.servings,
            allergens: ingredient.allergens,
            dietClassifications: ingredient.dietClassifications,
            sourceLabel: SYNTHETIC_SOURCE_LABEL,
        }));
    }

    /** Published recipes, each at its newest published version. */
    recipes(): readonly Recipe[] {
        return this.kitchenCatalogue.consumerRecipes();
    }

    recipe(recipeId: RecipeId): Recipe {
        const recipe = this.kitchenCatalogue.consumerRecipeById(recipeId);
        if (recipe === null) {
            throwFailure(
                apiFailure('server', {
                    message: `No recipe ${String(recipeId)} exists in this world.`,
                    retryable: false,
                }),
            );
        }
        return recipe;
    }

    /* ── catalogue reads the marketplace repositories answer from ──────────────────────────── */

    kitchens(): readonly Kitchen[] {
        return this.kitchenCatalogue.kitchens();
    }

    kitchen(kitchenId: KitchenId): Kitchen | null {
        return this.kitchenCatalogue.kitchenById(kitchenId);
    }

    meals(): readonly MarketplaceMeal[] {
        return this.kitchenCatalogue.consumerMeals();
    }

    meal(mealId: MealId): MarketplaceMeal | null {
        return this.kitchenCatalogue.consumerMealById(mealId);
    }

    marketplacePlans(): readonly SubscriptionPlan[] {
        return this.kitchenCatalogue.consumerPlans();
    }

    marketplacePlan(planId: SubscriptionPlanId): SubscriptionPlan | null {
        return this.kitchenCatalogue.consumerPlanById(planId);
    }

    groceryList(weekStart: string): GroceryList {
        const plan = [...this.#plans.values()].find(
            (candidate) => candidate.weekStart === weekStart,
        );
        return buildGroceryList(plan?.entries ?? [], weekStart, this.#pantry);
    }

    pantry(): Pantry {
        return this.#pantry;
    }

    /* ── nutrition targets ─────────────────────────────────────────────────────────────────── */

    calculateTargets(request: NutritionTargetRequest): NutritionTargetResult {
        return PROTOTYPE_TARGET_ENGINE.calculate(request);
    }

    currentTargets(): StoredNutritionTarget | null {
        return this.#target;
    }

    updateTargets(request: UpdateNutritionTargetRequest): StoredNutritionTarget {
        if (!request.acknowledgedDisclaimer) {
            throwFailure(
                validationFailure({
                    acknowledged_disclaimer: [
                        'The disclaimer has to be acknowledged before a target can be saved.',
                    ],
                }),
            );
        }

        const computed = PROTOTYPE_TARGET_ENGINE.calculate({
            ...request.source,
            ...(request.professionalOverride === undefined
                ? {}
                : { professionalOverride: request.professionalOverride }),
        });

        const id: NutritionTargetId = this.#target?.id ?? PROTOTYPE_STORED_TARGET.id;
        const result: NutritionTargetResult =
            request.targetEnergy === undefined
                ? { ...computed, id }
                : { ...computed, id, targetEnergy: request.targetEnergy };

        this.#target = {
            id,
            result,
            professionallyApproved: request.professionalOverride !== undefined,
            approvedBy: request.professionalOverride?.dietitianId ?? null,
            approvedAt: request.professionalOverride?.approvedAt ?? null,
            createdAt: this.#target?.createdAt ?? PROTOTYPE_NOW,
            updatedAt: PROTOTYPE_NOW,
        };
        return this.#target;
    }

    requestNutritionReview(request: RequestNutritionReviewRequest): NutritionReview {
        const review: NutritionReview = {
            id: `nutrition-review-${String(this.#nutritionReviews.length + 1).padStart(2, '0')}`,
            targetId: request.targetId,
            state: 'requested',
            dietitianId: request.dietitianId ?? null,
            requestedAt: PROTOTYPE_NOW,
            respondedAt: null,
            note: request.note ?? null,
        };
        this.#nutritionReviews = [review, ...this.#nutritionReviews];

        const queueId = `${String(request.targetId)}-review`;
        this.#reviews.set(queueId, {
            id: queueId,
            subject: 'nutrition_target',
            state: 'awaiting_review',
            priority: request.urgency ?? 'routine',
            clientId: PROTOTYPE_CUSTOMER_ID,
            clientDisplayName: PROTOTYPE_CUSTOMER_NAME,
            reasons: this.#target?.result.reviewReasons ?? ['client_requested_review'],
            targetId: request.targetId,
            planId: null,
            sessionId: null,
            requestedAt: PROTOTYPE_NOW,
            assignedTo: request.dietitianId ?? null,
        });
        return review;
    }

    /* ── cart and checkout ─────────────────────────────────────────────────────────────────── */

    cart(): Cart {
        if (this.#currentCartId === null) {
            const id = cartIdAt(0);
            this.#carts.set(id, { id, items: [], updatedAt: PROTOTYPE_NOW });
            this.#currentCartId = id;
        }
        return this.#projectCart(this.#mutableCart(this.#currentCartId));
    }

    #mutableCart(cartId: CartId): MutableCart {
        const cart = this.#carts.get(cartId);
        if (cart === undefined) {
            throwFailure(
                apiFailure('server', {
                    message: `No cart ${String(cartId)} exists in this world.`,
                    retryable: false,
                }),
            );
        }
        return cart;
    }

    #projectCart(cart: MutableCart): Cart {
        return {
            id: cart.id,
            items: [...cart.items],
            subtotal: aed(cart.items.reduce<number>((sum, item) => sum + item.lineTotal.amount, 0)),
            itemCount: cart.items.reduce<number>((count, item) => count + item.quantity, 0),
            updatedAt: cart.updatedAt,
        };
    }

    addCartItem(cartId: CartId, mealId: MealId, quantity: number, deliveryDate?: string): Cart {
        if (!Number.isInteger(quantity) || quantity <= 0) {
            throwFailure(validationFailure({ quantity: ['Order at least one.'] }));
        }
        const cart = this.#mutableCart(cartId);
        const meal = this.kitchenCatalogue.consumerMealById(mealId);
        if (meal === null) {
            throwFailure(
                apiFailure('server', {
                    message: `No marketplace meal ${String(mealId)} exists in this world.`,
                    retryable: false,
                }),
            );
        }

        const itemId = `${String(mealId)}:${deliveryDate ?? 'any'}`;
        const existing = cart.items.find((item) => item.id === itemId);
        const nextQuantity = (existing?.quantity ?? 0) + quantity;
        const line: CartItem = {
            id: itemId,
            mealId,
            kitchenId: meal.kitchenId,
            name: meal.name,
            quantity: nextQuantity,
            unitPrice: meal.price,
            lineTotal: money(meal.price.amount * nextQuantity, meal.price.currency),
            allergens: meal.allergens,
            deliveryDate: deliveryDate ?? null,
        };

        cart.items =
            existing === undefined
                ? [...cart.items, line]
                : cart.items.map((item) => (item.id === itemId ? line : item));
        cart.updatedAt = PROTOTYPE_NOW;
        return this.#projectCart(cart);
    }

    removeCartItem(cartId: CartId, itemId: string): Cart {
        const cart = this.#mutableCart(cartId);
        cart.items = cart.items.filter((item) => item.id !== itemId);
        cart.updatedAt = PROTOTYPE_NOW;
        return this.#projectCart(cart);
    }

    previewCheckout(request: PreviewCheckoutRequest): CheckoutPreview {
        const cart = this.#projectCart(this.#mutableCart(request.cartId));
        const deliveryFee =
            cart.subtotal.amount >= PROTOTYPE_FREE_DELIVERY_THRESHOLD_FILS
                ? null
                : aed(PROTOTYPE_DELIVERY_FEE_FILS);

        const lines: PriceLine[] = [{ code: 'subtotal', label: 'Subtotal', amount: cart.subtotal }];
        if (deliveryFee !== null) {
            lines.push({ code: 'delivery', label: 'Delivery', amount: deliveryFee });
        }

        const warnings: string[] = [];
        if (cart.items.length === 0) warnings.push('checkout.empty_cart');

        const excluded = new Set(
            PROTOTYPE_CONSTRAINTS.filter((constraint) => constraint.kind === 'allergy').map(
                (constraint) => constraint.code,
            ),
        );
        if (cart.items.some((item) => item.allergens.some((code) => excluded.has(code)))) {
            warnings.push(ALLERGEN_WARNING_CODE);
        }

        return {
            cartId: cart.id,
            lines,
            subtotal: cart.subtotal,
            deliveryFee,
            discount: null,
            total: aed(cart.subtotal.amount + (deliveryFee?.amount ?? 0)),
            earliestDeliveryDate:
                request.deliveryDate ??
                (cart.items.length === 0 ? null : addDays(PROTOTYPE_TODAY, 1)),
            warnings,
            // Structurally true, not a promise: this contract has no method that takes a payment.
            paymentDeferred: true,
        };
    }

    /**
     * Turn the priced basket into an order, and empty the basket.
     *
     * The mock's honesty rule: an order that is placed has to *exist* afterwards. The guest world
     * already worked this way — it prices through the same port, records the order and clears the
     * lines — and this mirrors it, over the same cart the catalogue screens filled, so a person can
     * place an order in mock mode and see the basket empty behind the confirmation. A stub that
     * resolved with an invented reference and left the basket full would put the two screens into a
     * state the real API can never produce.
     *
     * The refusals are the real ones, not decoration: an empty basket is `validation.failed` on
     * `cartId`, and a missing address is `validation.failed` on `addressId` — which is exactly what
     * the API repository raises before it sends anything.
     */
    placeOrder(request: PlaceOrderRequest): PlacedOrder {
        const cart = this.#projectCart(this.#mutableCart(request.cartId));

        if (cart.items.length === 0) {
            throwFailure(validationFailure({ cartId: ['The basket is empty.'] }));
        }
        if (request.addressId.trim() === '') {
            throwFailure(
                validationFailure({ addressId: ['Choose a delivery address before ordering.'] }),
            );
        }

        const quotation = this.previewCheckout({ cartId: request.cartId });
        const ordinal = this.#nextOrderOrdinal++;
        const id = orderIdAt(ordinal);

        const lines: readonly PlacedOrderLine[] = cart.items.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
        }));

        // The fixture world holds one delivery address, which is the one this person has. The
        // identifier is still required and still validated above, because it is required against
        // the real API and a mock that let it through would hide the failure until switch day.
        const address = PROTOTYPE_ADDRESS;

        const order: PlacedOrder = {
            id,
            // The human-quotable half. Ordinal rather than random so a fixture world replays
            // identically across runs, which is what makes a snapshot test worth having.
            reference: `H360-${String(1000 + ordinal)}`,
            state: 'placed',
            lines,
            priceLines: quotation.lines,
            total: quotation.total,
            address,
            slotCode: request.slotCode ?? '',
            deliveryDate: request.deliveryDate ?? quotation.earliestDeliveryDate ?? '',
            placedAt: PROTOTYPE_NOW,
        };

        this.#orders.set(order.reference, order);

        // The basket becomes the order. Leaving the lines behind would let somebody place the same
        // basket twice from one screen, which no real checkout allows.
        const mutable = this.#mutableCart(request.cartId);
        mutable.items = [];
        mutable.updatedAt = PROTOTYPE_NOW;

        return order;
    }

    /** A placed order, by the reference the confirmation screen was given. */
    order(reference: string): PlacedOrder | null {
        return this.#orders.get(reference) ?? null;
    }

    /* ── subscriptions ─────────────────────────────────────────────────────────────────────── */

    previewSubscription(configuration: SubscriptionConfiguration): SubscriptionPreview {
        const plan = this.kitchenCatalogue.consumerPlanById(configuration.planId);
        if (plan === null) {
            throwFailure(
                apiFailure('server', {
                    message: `No subscription plan ${String(configuration.planId)} exists.`,
                    retryable: false,
                }),
            );
        }
        const variant = this.kitchenCatalogue.consumerPlanVariantById(configuration.variantId);
        if (variant === null || variant.planId !== plan.id) {
            throwFailure(validationFailure({ variant_id: ['That variant is not on this plan.'] }));
        }

        const weeks = PLAN_DURATION_WEEKS[configuration.duration];
        const discountPercent =
            plan.durations.find((option) => option.duration === configuration.duration)
                ?.discountPercent ?? 0;
        const gross = variant.pricePerWeek.amount * weeks;
        const total = aed(Math.round((gross * (100 - discountPercent)) / 100));

        const allowed = this.kitchenCatalogue.deliveryWeekdaysFor(plan.id);
        const warnings: string[] = [];
        if (configuration.deliveryWeekdays.length === 0) {
            warnings.push('subscription.no_delivery_days');
        }
        if (configuration.deliveryWeekdays.some((weekday) => !allowed.includes(weekday))) {
            warnings.push('subscription.delivery_day_unavailable');
        }
        if (!PROTOTYPE_DELIVERY_SLOTS.some((slot) => slot.code === configuration.slotCode)) {
            warnings.push('subscription.unknown_slot');
        }

        const dates = this.#deliveryDates(configuration, weeks);
        const lines: PriceLine[] = [
            { code: 'weekly', label: 'Weekly price', amount: variant.pricePerWeek },
            { code: 'gross', label: `${String(weeks)} weeks`, amount: aed(gross) },
        ];
        if (discountPercent > 0) {
            lines.push({
                code: 'discount',
                label: `Duration discount (${String(discountPercent)} %)`,
                amount: aed(-(gross - total.amount)),
            });
        }

        return {
            configuration,
            lines,
            weeklyPrice: variant.pricePerWeek,
            discountPercent,
            total,
            firstDeliveryDate: dates[0] ?? configuration.startDate,
            lastDeliveryDate: dates[dates.length - 1] ?? configuration.startDate,
            deliveryCount: dates.length,
            warnings,
            paymentDeferred: true,
        };
    }

    #deliveryDates(configuration: SubscriptionConfiguration, weeks: number): readonly string[] {
        const dates: string[] = [];
        for (let offset = 0; offset < weeks * 7; offset += 1) {
            const date = addDays(configuration.startDate, offset);
            if (configuration.deliveryWeekdays.includes(isoWeekday(date))) dates.push(date);
        }
        return dates;
    }

    createSubscription(request: CreateSubscriptionRequest): Subscription {
        if (!request.acknowledgedTerms) {
            throwFailure(
                validationFailure({
                    acknowledged_terms: ['The summary has to be acknowledged before subscribing.'],
                }),
            );
        }
        const preview = this.previewSubscription(request.configuration);
        const plan = this.kitchenCatalogue.consumerPlanById(request.configuration.planId);
        if (plan === null) {
            throwFailure(apiFailure('server', { message: 'That plan is no longer available.' }));
        }

        this.#nextSubscriptionOrdinal += 1;
        const id = subscriptionIdAt(this.#nextSubscriptionOrdinal);
        const subscription: Subscription = {
            id,
            state: 'active',
            configuration: request.configuration,
            planName: plan.name,
            kitchenId: plan.kitchenId,
            weeklyPrice: preview.weeklyPrice,
            nextDeliveryDate: preview.firstDeliveryDate,
            skippedDates: [],
            pausedUntil: null,
            createdAt: PROTOTYPE_NOW,
            updatedAt: PROTOTYPE_NOW,
        };
        this.#subscriptions.set(id, subscription);
        return subscription;
    }

    subscription(subscriptionId: SubscriptionId): Subscription {
        const subscription = this.#subscriptions.get(subscriptionId);
        if (subscription === undefined) {
            throwFailure(
                apiFailure('server', {
                    message: `No subscription ${String(subscriptionId)} exists in this world.`,
                    retryable: false,
                }),
            );
        }
        return subscription;
    }

    subscriptions(): readonly Subscription[] {
        return [...this.#subscriptions.values()];
    }

    /**
     * Subscription state transitions.
     *
     * Guarded rather than assumed: pausing a cancelled subscription, or resuming one that was never
     * paused, is a validation failure carrying a sentence a person can read. A prototype where every
     * button works from every state teaches the wrong thing about the product.
     */
    #transition(
        subscriptionId: SubscriptionId,
        allowed: readonly Subscription['state'][],
        change: (current: Subscription) => Subscription,
    ): Subscription {
        const current = this.subscription(subscriptionId);
        if (!allowed.includes(current.state)) {
            throwFailure(
                validationFailure({
                    state: [
                        `A ${current.state.replace(/_/g, ' ')} subscription cannot do that. It has ` +
                            `to be ${allowed.join(' or ').replace(/_/g, ' ')} first.`,
                    ],
                }),
            );
        }
        const next = { ...change(current), updatedAt: PROTOTYPE_NOW };
        this.#subscriptions.set(subscriptionId, next);
        return next;
    }

    pauseSubscription(
        subscriptionId: SubscriptionId,
        request?: PauseSubscriptionRequest,
    ): Subscription {
        return this.#transition(subscriptionId, ['active', 'skipped_today'], (current) => ({
            ...current,
            state: 'paused',
            pausedUntil: request?.until ?? null,
            nextDeliveryDate: null,
        }));
    }

    resumeSubscription(subscriptionId: SubscriptionId): Subscription {
        return this.#transition(subscriptionId, ['paused'], (current) => ({
            ...current,
            state: 'active',
            pausedUntil: null,
            nextDeliveryDate: this.#nextDeliveryAfter(current, PROTOTYPE_TODAY),
        }));
    }

    skipDay(subscriptionId: SubscriptionId, request: SkipDayRequest): Subscription {
        return this.#transition(subscriptionId, ['active', 'skipped_today'], (current) => {
            const skipped = current.skippedDates.includes(request.date)
                ? current.skippedDates
                : [...current.skippedDates, request.date].sort();
            return {
                ...current,
                // Skipping *today* is its own state: the subscription is live, nothing is coming,
                // and a screen must be able to say so without inspecting a list of dates.
                state: request.date === PROTOTYPE_TODAY ? 'skipped_today' : current.state,
                skippedDates: skipped,
                nextDeliveryDate: this.#nextDeliveryAfter(
                    { ...current, skippedDates: skipped },
                    PROTOTYPE_TODAY,
                ),
            };
        });
    }

    changeAddress(subscriptionId: SubscriptionId, request: ChangeAddressRequest): Subscription {
        return this.#transition(
            subscriptionId,
            ['active', 'paused', 'skipped_today'],
            (current) => ({
                ...current,
                configuration: { ...current.configuration, address: request.address },
            }),
        );
    }

    changeSlot(subscriptionId: SubscriptionId, request: ChangeSlotRequest): Subscription {
        if (!PROTOTYPE_DELIVERY_SLOTS.some((slot) => slot.code === request.slotCode)) {
            throwFailure(validationFailure({ slot_code: ['That delivery slot does not exist.'] }));
        }
        return this.#transition(
            subscriptionId,
            ['active', 'paused', 'skipped_today'],
            (current) => ({
                ...current,
                configuration: {
                    ...current.configuration,
                    slotCode: request.slotCode,
                    deliveryWeekdays:
                        request.deliveryWeekdays ?? current.configuration.deliveryWeekdays,
                },
            }),
        );
    }

    #nextDeliveryAfter(subscription: Subscription, from: string): string | null {
        const skipped = new Set(subscription.skippedDates);
        for (let offset = 1; offset <= 28; offset += 1) {
            const date = addDays(from, offset);
            if (
                subscription.configuration.deliveryWeekdays.includes(isoWeekday(date)) &&
                !skipped.has(date)
            ) {
                return date;
            }
        }
        return null;
    }

    /* ── virtual dietitian ─────────────────────────────────────────────────────────────────── */

    createVdSession(request?: CreateVdSessionRequest): VdSession {
        this.#nextSessionOrdinal += 1;
        const id = vdSessionIdAt(this.#nextSessionOrdinal);
        const session = makeVdSession(id, 'initial_interview', {
            messages: [
                this.#vdMessage(id, 'system', VD_DISCLAIMER),
                this.#vdMessage(id, 'assistant', VD_ASSISTANT_SCRIPT.initial_interview),
            ],
            ...(request?.useProfile === true && this.#target !== null
                ? { proposal: makeVdProposal() }
                : {}),
        });
        this.#sessions.set(id, session);
        return session;
    }

    #vdMessage(
        sessionId: VdSessionId,
        origin: VdMessage['origin'],
        body: string,
        collected?: VdMessage['collected'],
    ): VdMessage {
        this.#nextMessageOrdinal += 1;
        return makeVdMessage({
            ordinal: this.#nextMessageOrdinal,
            sessionId,
            origin,
            body,
            ...(collected === undefined ? {} : { collected }),
        });
    }

    vdSession(sessionId: VdSessionId): VdSession {
        const session = this.#sessions.get(sessionId);
        if (session === undefined) {
            throwFailure(
                apiFailure('server', {
                    message: `No Virtual Dietitian session ${String(sessionId)} exists.`,
                    retryable: false,
                }),
            );
        }
        return session;
    }

    vdSessions(): readonly VdSession[] {
        return [...this.#sessions.values()];
    }

    /**
     * One user turn.
     *
     * The script decides what comes back, in one of two ways. A stated safety marker escalates
     * immediately and terminally — no proposal, no draft, no further turns. Anything else moves the
     * session one step along `VD_PROGRESSION`, which is what makes the states walkable in a test
     * rather than merely renderable from a fixture.
     */
    sendVdMessage(sessionId: VdSessionId, request: SendVdMessageRequest): VdSession {
        const session = this.vdSession(sessionId);
        const marker = detectSafetyMarker(request.body);

        const withUser: VdMessage[] = [
            ...session.messages,
            this.#vdMessage(sessionId, 'user', request.body, request.answers ?? null),
        ];

        if (marker !== null) {
            return this.#saveSession({
                ...session,
                state: 'safety_escalation',
                messages: [
                    ...withUser,
                    this.#vdMessage(sessionId, 'assistant', VD_ASSISTANT_SCRIPT.safety_escalation),
                ],
                safetyNotices: [VD_ESCALATION_NOTICE],
                updatedAt: PROTOTYPE_NOW,
            });
        }

        if (session.state === 'safety_escalation') {
            throwFailure(
                validationFailure({
                    body: [
                        'This conversation has been handed to a person and cannot be continued here.',
                    ],
                }),
            );
        }

        const index = VD_PROGRESSION.indexOf(session.state);
        const nextState: VdSessionState =
            index === -1 || index === VD_PROGRESSION.length - 1
                ? 'suggested_meal_structure'
                : (VD_PROGRESSION[index + 1] ?? 'suggested_meal_structure');

        return this.#saveSession({
            ...session,
            state: nextState,
            messages: [
                ...withUser,
                this.#vdMessage(sessionId, 'assistant', VD_ASSISTANT_SCRIPT[nextState]),
            ],
            missingInformation:
                nextState === 'missing_information' ? VD_MISSING_INFORMATION_FIXTURES : [],
            proposal:
                nextState === 'suggested_targets' || nextState === 'suggested_meal_structure'
                    ? (session.proposal ?? makeVdProposal())
                    : session.proposal,
            updatedAt: PROTOTYPE_NOW,
        });
    }

    #saveSession(session: VdSession): VdSession {
        this.#sessions.set(session.id, session);
        return session;
    }

    generateVdDraft(sessionId: VdSessionId, request: GenerateVdDraftRequest): VdSession {
        const session = this.vdSession(sessionId);
        if (!request.acknowledgedDisclaimer) {
            throwFailure(
                validationFailure({
                    acknowledged_disclaimer: [
                        'The disclaimer has to be acknowledged before a draft is generated.',
                    ],
                }),
            );
        }
        if (session.state === 'safety_escalation') {
            throwFailure(
                validationFailure({
                    session: ['This session has been escalated and cannot generate a plan.'],
                }),
            );
        }

        const draftId = PROTOTYPE_PLAN_IDS.draft;
        this.#plans.set(draftId, {
            id: draftId,
            userId: PROTOTYPE_CUSTOMER_ID,
            name: 'Virtual Dietitian draft',
            state: 'draft',
            weekStart: request.weekStart,
            entries: [
                ...makeWeekEntries({
                    planId: draftId,
                    weekStart: request.weekStart,
                    ordinalBase: 0x40,
                    targets: this.#projection().targets,
                }),
            ],
            customerNote: null,
            notesUpdatedAt: null,
            history: [],
            generatedAt: PROTOTYPE_NOW,
            updatedAt: PROTOTYPE_NOW,
        });

        return this.#saveSession({
            ...session,
            state: 'draft_generated',
            draftPlanId: draftId,
            messages: [
                ...session.messages,
                this.#vdMessage(sessionId, 'assistant', VD_ASSISTANT_SCRIPT.draft_generated),
            ],
            proposal: session.proposal ?? makeVdProposal(),
            updatedAt: PROTOTYPE_NOW,
        });
    }

    requestVdReview(sessionId: VdSessionId, request?: RequestVdReviewRequest): VdSession {
        const session = this.vdSession(sessionId);
        const reviewId = `${String(sessionId)}-review`;
        this.#reviews.set(reviewId, {
            id: reviewId,
            subject: 'virtual_dietitian',
            state: 'awaiting_review',
            priority: 'routine',
            clientId: PROTOTYPE_CUSTOMER_ID,
            clientDisplayName: PROTOTYPE_CUSTOMER_NAME,
            reasons: ['client_requested_review'],
            targetId: this.#target?.id ?? null,
            planId: session.draftPlanId,
            sessionId,
            requestedAt: PROTOTYPE_NOW,
            assignedTo: request?.dietitianId ?? null,
        });

        return this.#saveSession({
            ...session,
            state: 'review_requested',
            reviewRequestedAt: PROTOTYPE_NOW,
            messages: [
                ...session.messages,
                this.#vdMessage(sessionId, 'assistant', VD_ASSISTANT_SCRIPT.review_requested),
            ],
            updatedAt: PROTOTYPE_NOW,
        });
    }

    acceptVdProposal(sessionId: VdSessionId, request: AcceptVdProposalRequest): VdSession {
        const session = this.vdSession(sessionId);
        if (!request.acknowledgedDisclaimer) {
            throwFailure(
                validationFailure({
                    acknowledged_disclaimer: [
                        'The disclaimer has to be acknowledged before accepting a proposal.',
                    ],
                }),
            );
        }
        const proposal = session.proposal ?? makeVdProposal();
        return this.#saveSession({
            ...session,
            proposal: { ...proposal, acceptedAt: PROTOTYPE_NOW },
            updatedAt: PROTOTYPE_NOW,
        });
    }

    overrideVdProposal(
        sessionId: VdSessionId,
        request: OverrideVdProposalRequest,
        dietitianId: DietitianId | null = null,
    ): VdSession {
        const session = this.vdSession(sessionId);
        const proposal = session.proposal ?? makeVdProposal();
        return this.#saveSession({
            ...session,
            proposal: {
                ...proposal,
                macros: request.macros ?? proposal.macros,
                mealStructure: request.mealStructure ?? proposal.mealStructure,
                rationale: [...proposal.rationale, `Human override: ${request.reason}`],
                overriddenAt: PROTOTYPE_NOW,
                overriddenBy: dietitianId,
            },
            messages: [
                ...session.messages,
                this.#vdMessage(
                    sessionId,
                    'dietitian',
                    `This proposal has been changed by a person. Reason: ${request.reason}`,
                ),
            ],
            updatedAt: PROTOTYPE_NOW,
        });
    }

    /* ── professional queue ────────────────────────────────────────────────────────────────── */

    reviewQueue(): readonly ReviewQueueItem[] {
        return [...this.#reviews.values()];
    }

    review(reviewId: string): ReviewDetail {
        const item = this.#reviews.get(reviewId);
        if (item === undefined) {
            throwFailure(
                apiFailure('server', {
                    message: `No review ${reviewId} exists in this world.`,
                    retryable: false,
                }),
            );
        }
        return {
            item,
            target: item.targetId === null ? null : this.#target,
            planWeek:
                item.planId === null
                    ? null
                    : this.getWeek(item.planId, this.#plan(item.planId).weekStart),
            clientNote: PROTOTYPE_CLIENT_NOTE,
            context: PROTOTYPE_REVIEW_CONTEXT,
        };
    }

    approveReview(reviewId: string, request: ApproveReviewRequest): ReviewQueueItem {
        const detail = this.review(reviewId);
        const approved: ReviewQueueItem = { ...detail.item, state: 'approved' };
        this.#reviews.set(reviewId, approved);

        if (detail.item.subject === 'nutrition_target' && this.#target !== null) {
            this.#target = {
                ...this.#target,
                professionallyApproved: true,
                approvedBy: detail.item.assignedTo,
                approvedAt: PROTOTYPE_NOW,
                updatedAt: PROTOTYPE_NOW,
            };
        }
        if (detail.item.planId !== null && this.#plans.has(detail.item.planId)) {
            this.#record(
                this.#plan(detail.item.planId),
                'professionally_approved',
                'dietitian',
                `Approved by ${request.signature}.`,
            );
        }
        if (detail.item.sessionId !== null) {
            const session = this.vdSession(detail.item.sessionId);
            this.#saveSession({
                ...session,
                state: 'professionally_approved',
                approvedAt: PROTOTYPE_NOW,
                reviewedBy: detail.item.assignedTo,
                updatedAt: PROTOTYPE_NOW,
            });
        }
        return approved;
    }

    requestReviewChanges(reviewId: string, request: RequestChangesRequest): ReviewQueueItem {
        const detail = this.review(reviewId);
        const updated: ReviewQueueItem = {
            ...detail.item,
            state: 'changes_requested',
            priority: request.priority ?? detail.item.priority,
        };
        this.#reviews.set(reviewId, updated);
        if (detail.item.planId !== null && this.#plans.has(detail.item.planId)) {
            this.#record(
                this.#plan(detail.item.planId),
                'notes_updated',
                'dietitian',
                `Changes requested: ${request.note}`,
            );
        }
        return updated;
    }

    setDietitianNote(request: SetDietitianNoteRequest, authorId: DietitianId): DietitianNote {
        const note: DietitianNote = {
            planId: request.planId,
            entryId: request.entryId ?? null,
            note: request.note,
            authorId,
            updatedAt: PROTOTYPE_NOW,
        };
        this.#dietitianNotes.set(request.planId, note);
        const plan = this.#plans.get(request.planId);
        if (plan !== undefined) {
            this.#record(plan, 'notes_updated', 'dietitian', 'Dietitian note updated.');
        }
        return note;
    }

    setOverride(request: SetOverrideRequest, dietitianId: DietitianId): StoredNutritionTarget {
        const current = this.#target;
        if (current === null) {
            throwFailure(
                apiFailure('server', {
                    message: 'This client has no stored target to override.',
                    retryable: false,
                }),
            );
        }

        const result = PROTOTYPE_TARGET_ENGINE.calculate({
            ...current.result.request,
            professionalOverride: {
                dietitianId,
                reason: request.reason,
                approvedAt: PROTOTYPE_NOW,
                energyKilocalories: request.targetEnergy ?? null,
                macros: request.macros ?? null,
            },
        });

        this.#target = {
            ...current,
            result: { ...result, id: current.id },
            professionallyApproved: true,
            approvedBy: dietitianId,
            approvedAt: PROTOTYPE_NOW,
            updatedAt: PROTOTYPE_NOW,
        };
        return this.#target;
    }

    /* ── business ──────────────────────────────────────────────────────────────────────────── */

    programme(programmeId: CorporateProgrammeId): CorporateProgramme {
        const programme = programmeById(programmeId);
        if (programme === null) {
            throwFailure(
                apiFailure('context.organisation_required', {
                    message: 'That corporate programme is not visible to this session.',
                }),
            );
        }
        return programme;
    }

    catalogue(programmeId: CorporateProgrammeId): readonly CatalogueItem[] {
        return PROTOTYPE_CATALOGUE_ITEMS.filter((item) => item.programmeId === programmeId);
    }

    catalogueItem(itemId: string): CatalogueItem {
        const item = catalogueItemById(itemId);
        if (item === null) {
            throwFailure(
                apiFailure('server', {
                    message: `No catalogue item ${itemId} exists in this world.`,
                    retryable: false,
                }),
            );
        }
        return item;
    }

    quotations(): readonly Quotation[] {
        return [...this.#quotations];
    }

    requestQuotation(request: RequestQuotationRequest): Quotation {
        if (request.lines.length === 0) {
            throwFailure(validationFailure({ lines: ['Add at least one line to a quotation.'] }));
        }
        const programme = this.programme(request.programmeId);

        const lines = request.lines.map((line) => {
            const item = this.catalogueItem(line.catalogueItemId);
            if (line.quantity < item.minimumOrderQuantity) {
                throwFailure(
                    validationFailure({
                        quantity: [
                            `${item.name} has a minimum order of ${String(item.minimumOrderQuantity)}.`,
                        ],
                    }),
                );
            }
            return {
                catalogueItemId: item.id,
                name: item.name,
                quantity: line.quantity,
                // A submitted request carries no price: pricing is the account manager's act, and a
                // prototype that quotes a total back has invented a commercial commitment.
                quotedUnitPrice: null,
                quotedTotal: null,
            };
        });

        this.#nextQuotationOrdinal += 1;
        const quotation: Quotation = {
            id: quotationIdAt(this.#nextQuotationOrdinal),
            programmeId: programme.id,
            state: 'submitted',
            reference: `${QUOTATION_REFERENCE_PREFIX}-2026-${String(1000 + this.#quotations.length)}`,
            lines,
            requestedTotal: null,
            requestedDeliveryDate: request.requestedDeliveryDate ?? null,
            recurring: request.recurring ?? false,
            note: request.note ?? null,
            requestedAt: PROTOTYPE_NOW,
            respondedAt: null,
            expiresAt: null,
        };
        this.#quotations = [quotation, ...this.#quotations];
        return quotation;
    }
}

/**
 * Warnings for an entry whose figures were scaled rather than rebuilt.
 *
 * Kept beside the store because the fixture builder derives the same two codes from the same two
 * facts; if they ever disagree, the planner would show a warning on one path and not the other.
 */
function deriveWarningsFor(
    allergens: MealPlanEntry['allergens'],
    nutrition: NutritionFacts,
    targets: readonly NutrientTarget[],
): readonly string[] {
    const blocking = new Set(
        PROTOTYPE_CONSTRAINTS.filter((constraint) => constraint.kind === 'allergy').map(
            (constraint) => constraint.code,
        ),
    );
    const warnings: string[] = [];
    if (allergens.some((code) => blocking.has(code))) warnings.push(ALLERGEN_WARNING_CODE);

    const energy = targets.find((target) => target.nutrientId === 'energy');
    const value = nutrition.amounts.find((amount) => amount.nutrientId === 'energy')?.value ?? 0;
    if (energy !== undefined && energy.value > 0 && value > energy.value * 0.5) {
        warnings.push('planner.energy_out_of_range');
    }
    return warnings;
}

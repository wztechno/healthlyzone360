import type {
    AllergenCode,
    DietitianId,
    IsoDateTime,
    KitchenId,
    MealId,
    MealPlanEntryId,
    MealPlanId,
    MealType,
    Money,
    RecipeId,
    UserId,
} from '@healthy360/domain-types';
import type {
    DailyNutritionSummary,
    NutrientTarget,
    NutritionFacts,
    WeeklyNutritionSummary,
} from '@healthy360/nutrition';

import type { CursorPage, CursorPageRequest } from './pagination.ts';

/**
 * The meal-planner contract (Prompt 2, "Meal planner").
 *
 * **Proposed, not implemented.**
 *
 * The shape of this interface is the important part. Regeneration exists at three scopes — week,
 * day, entry — as three separate calls rather than one call with a scope parameter, because they
 * are different operations: regenerating a week may move meals between days, regenerating an entry
 * may not, and a caller that cannot tell them apart will eventually invoke the wrong one. Locked
 * entries survive every scope; that is what a lock is for.
 */

/** What is actually sitting in a planner slot. */
export const PLAN_ENTRY_KINDS = ['food', 'recipe', 'kitchen_meal', 'restaurant'] as const;
export type PlanEntryKind = (typeof PLAN_ENTRY_KINDS)[number];

export interface MealPlanEntry {
    readonly id: MealPlanEntryId;
    readonly planId: MealPlanId;
    /** `YYYY-MM-DD`. */
    readonly date: string;
    readonly mealType: MealType;
    /** Position within the meal type, so two snacks keep a stable order. */
    readonly position: number;
    readonly kind: PlanEntryKind;
    readonly label: string;
    readonly recipeId: RecipeId | null;
    readonly mealId: MealId | null;
    readonly kitchenId: KitchenId | null;
    /** Free-text venue for a planned restaurant meal; no place database is implied. */
    readonly restaurantName: string | null;
    readonly portionFactor: number;
    readonly nutrition: NutritionFacts;
    readonly allergens: readonly AllergenCode[];
    readonly estimatedCost: Money | null;
    readonly preparationMinutes: number | null;
    /** A locked entry is never touched by any regeneration. */
    readonly locked: boolean;
    /** This entry is a portion of an earlier entry's yield. */
    readonly isLeftover: boolean;
    readonly leftoverOfEntryId: MealPlanEntryId | null;
    /** Set when a dietitian has signed off this specific entry. */
    readonly approvedBy: DietitianId | null;
    /** Codes such as `planner.allergen_conflict`, surfaced as warnings on the card. */
    readonly warnings: readonly string[];
}

export interface MealPlanDay {
    readonly planId: MealPlanId;
    readonly date: string;
    readonly entries: readonly MealPlanEntry[];
    readonly summary: DailyNutritionSummary;
    readonly targets: readonly NutrientTarget[];
}

export const MEAL_PLAN_STATES = ['draft', 'active', 'archived', 'template'] as const;
export type MealPlanState = (typeof MEAL_PLAN_STATES)[number];

export interface MealPlanWeek {
    readonly planId: MealPlanId;
    readonly userId: UserId;
    readonly state: MealPlanState;
    /** Monday, `YYYY-MM-DD`. */
    readonly weekStart: string;
    readonly days: readonly MealPlanDay[];
    readonly summary: WeeklyNutritionSummary;
    readonly targets: readonly NutrientTarget[];
    readonly generatedAt: IsoDateTime | null;
    readonly updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------------------------------------
 * Requests
 * ---------------------------------------------------------------------------------------------- */

/** Where the food comes from — the "kitchen-delivered vs home-prepared" question from onboarding. */
export const PREPARATION_MODES = ['home_prepared', 'kitchen_prepared', 'mixed'] as const;
export type PreparationMode = (typeof PREPARATION_MODES)[number];

export interface GeneratePlanRequest {
    readonly weekStart: string;
    readonly mealsPerDay?: number | undefined;
    readonly snacksPerDay?: number | undefined;
    readonly preparationMode?: PreparationMode | undefined;
    readonly preferredKitchenIds?: readonly KitchenId[] | undefined;
    /** Budget ceiling for the week, in minor units. */
    readonly weeklyBudget?: Money | undefined;
    readonly maximumPreparationMinutes?: number | undefined;
    /** Reuse an existing plan's settings rather than the profile defaults. */
    readonly basedOnPlanId?: MealPlanId | undefined;
}

export interface RegenerateScopeRequest {
    /** Locked entries are never replaced; `true` is the only accepted value and is the default. */
    readonly respectLocks?: true | undefined;
    /** Avoid these, e.g. because the person just rejected them. */
    readonly excludeMealIds?: readonly MealId[] | undefined;
    readonly excludeRecipeIds?: readonly RecipeId[] | undefined;
    readonly note?: string | undefined;
}

/** Replacing once versus replacing every future occurrence of a recurring entry. */
export const REPLACEMENT_MODES = ['once', 'recurring'] as const;
export type ReplacementMode = (typeof REPLACEMENT_MODES)[number];

export interface ReplaceEntryRequest {
    readonly mode: ReplacementMode;
    readonly kind: PlanEntryKind;
    readonly recipeId?: RecipeId | undefined;
    readonly mealId?: MealId | undefined;
    readonly restaurantName?: string | undefined;
    readonly label?: string | undefined;
    readonly portionFactor?: number | undefined;
    /**
     * Set when the replacement violates a `user_confirmed` constraint and the person has confirmed
     * it anyway. Never accepted for an allergy or a dietitian-enforced restriction.
     */
    readonly confirmedWarnings?: readonly string[] | undefined;
}

export interface AddEntryRequest {
    readonly date: string;
    readonly mealType: MealType;
    readonly kind: PlanEntryKind;
    readonly label?: string | undefined;
    readonly recipeId?: RecipeId | undefined;
    readonly mealId?: MealId | undefined;
    readonly restaurantName?: string | undefined;
    /** For a `food` entry: a searched food and the quantity in grams. */
    readonly foodId?: string | undefined;
    readonly grams?: number | undefined;
    readonly portionFactor?: number | undefined;
    readonly position?: number | undefined;
}

export interface RepeatMealRequest {
    readonly entryId: MealPlanEntryId;
    /** Dates to copy it to, `YYYY-MM-DD`. */
    readonly dates: readonly string[];
    readonly mealType?: MealType | undefined;
    /** Mark the copies as leftovers of the original rather than independent entries. */
    readonly asLeftovers?: boolean | undefined;
}

export interface AdjustPortionRequest {
    readonly portionFactor: number;
}

export const PLAN_NOTE_AUTHORS = ['customer', 'dietitian'] as const;
export type PlanNoteAuthor = (typeof PLAN_NOTE_AUTHORS)[number];

export interface PlanNotes {
    readonly planId: MealPlanId;
    /** The person's own notes on the plan. */
    readonly customerNote: string | null;
    /** The dietitian's notes. Read-only for the customer; written through `./professional.ts`. */
    readonly dietitianNote: string | null;
    readonly updatedAt: IsoDateTime | null;
}

export interface SetPlanNotesRequest {
    readonly customerNote: string | null;
}

export const PLAN_HISTORY_ACTIONS = [
    'generated',
    'week_regenerated',
    'day_regenerated',
    'entry_regenerated',
    'entry_replaced',
    'entry_added',
    'entry_removed',
    'entry_locked',
    'entry_unlocked',
    'portion_adjusted',
    'meal_repeated',
    'notes_updated',
    'professionally_approved',
] as const;
export type PlanHistoryAction = (typeof PLAN_HISTORY_ACTIONS)[number];

export interface PlanHistoryEvent {
    readonly id: string;
    readonly planId: MealPlanId;
    readonly action: PlanHistoryAction;
    readonly at: IsoDateTime;
    readonly actor: PlanNoteAuthor | 'system';
    /** Human-readable summary; the UI shows this rather than reconstructing one. */
    readonly summary: string;
    readonly entryId: MealPlanEntryId | null;
    readonly date: string | null;
}

export interface SaveTemplateRequest {
    readonly name: string;
    readonly description?: string | undefined;
}

export interface DuplicatePlanRequest {
    /** Monday of the week to copy into, `YYYY-MM-DD`. */
    readonly weekStart: string;
    readonly includeNotes?: boolean | undefined;
}

export interface MealPlanSummary {
    readonly planId: MealPlanId;
    readonly name: string | null;
    readonly state: MealPlanState;
    readonly weekStart: string;
    readonly updatedAt: IsoDateTime;
}

export interface MealPlanRepository {
    /**
     * `GET /api/v1/meal-plans` — the person's plans, newest first. Added at the Wave 2 gate:
     * every other operation takes a `{plan}` the client was assumed to already hold, leaving no
     * way to discover one (Wave 2 worked around it through the approved Virtual Dietitian
     * session's draft; Wave 4 must not).
     */
    listPlans(request?: CursorPageRequest): Promise<CursorPage<MealPlanSummary>>;

    /** `GET /api/v1/meal-plans/current` — the active plan, or `null` when none exists. */
    getCurrentPlan(): Promise<MealPlanSummary | null>;

    /** `GET /api/v1/meal-plans/{plan}` for a week. `weekStart` is Monday, `YYYY-MM-DD`. */
    getWeek(planId: MealPlanId, weekStart: string): Promise<MealPlanWeek>;
    getDay(planId: MealPlanId, date: string): Promise<MealPlanDay>;

    /** `POST /api/v1/meal-plans/generate`. */
    generate(request: GeneratePlanRequest): Promise<MealPlanWeek>;

    regenerateWeek(planId: MealPlanId, request?: RegenerateScopeRequest): Promise<MealPlanWeek>;
    regenerateDay(
        planId: MealPlanId,
        date: string,
        request?: RegenerateScopeRequest,
    ): Promise<MealPlanDay>;
    regenerateEntry(
        planId: MealPlanId,
        entryId: MealPlanEntryId,
        request?: RegenerateScopeRequest,
    ): Promise<MealPlanEntry>;

    lockEntry(planId: MealPlanId, entryId: MealPlanEntryId): Promise<MealPlanEntry>;
    unlockEntry(planId: MealPlanId, entryId: MealPlanEntryId): Promise<MealPlanEntry>;

    /** Replaces one occurrence, or every future occurrence of a recurring entry. */
    replaceEntry(
        planId: MealPlanId,
        entryId: MealPlanEntryId,
        request: ReplaceEntryRequest,
    ): Promise<readonly MealPlanEntry[]>;

    adjustPortion(
        planId: MealPlanId,
        entryId: MealPlanEntryId,
        request: AdjustPortionRequest,
    ): Promise<MealPlanEntry>;

    addEntry(planId: MealPlanId, request: AddEntryRequest): Promise<MealPlanEntry>;
    removeEntry(planId: MealPlanId, entryId: MealPlanEntryId): Promise<void>;

    repeatMeal(planId: MealPlanId, request: RepeatMealRequest): Promise<readonly MealPlanEntry[]>;

    getNotes(planId: MealPlanId): Promise<PlanNotes>;
    setNotes(planId: MealPlanId, request: SetPlanNotesRequest): Promise<PlanNotes>;

    history(planId: MealPlanId, request?: CursorPageRequest): Promise<CursorPage<PlanHistoryEvent>>;

    saveAsTemplate(planId: MealPlanId, request: SaveTemplateRequest): Promise<MealPlanSummary>;
    duplicate(planId: MealPlanId, request: DuplicatePlanRequest): Promise<MealPlanWeek>;
}

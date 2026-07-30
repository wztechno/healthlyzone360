import type {
    DietitianId,
    IsoDateTime,
    MealPlanEntryId,
    MealPlanId,
    NutritionTargetId,
    UserId,
    VdSessionId,
} from '@healthy360/domain-types';
import type { MacroTarget, NutrientTarget } from '@healthy360/nutrition';

import type { CursorPage, CursorPageRequest } from './pagination.ts';
import type { MealPlanWeek } from './planner.ts';
import type { StoredNutritionTarget } from './nutrition.ts';

/**
 * The dietitian's side (Prompt 2, "professional-client workflows").
 *
 * **Proposed, not implemented.**
 *
 * The review queue is where the product's safety story is actually paid for: every
 * `requiresProfessionalReview` flag the target engine raises, every Virtual Dietitian session that
 * escalated, and every plan a person asked a human to check arrives here. If this contract does not
 * exist, those flags are decoration.
 *
 * A professional acts on a named client, so every method is scoped by an identifier the caller had
 * to be handed — there is no "list all clients" here, and access is the backend's decision to make
 * (plan §10, the relationship check), not this interface's.
 */

export const REVIEW_SUBJECTS = ['nutrition_target', 'meal_plan', 'virtual_dietitian'] as const;
export type ReviewSubject = (typeof REVIEW_SUBJECTS)[number];

export const REVIEW_QUEUE_STATES = [
    'awaiting_review',
    'in_review',
    'changes_requested',
    'approved',
    'declined',
] as const;
export type ReviewQueueState = (typeof REVIEW_QUEUE_STATES)[number];

export const REVIEW_PRIORITIES = ['routine', 'soon', 'urgent'] as const;
export type ReviewPriority = (typeof REVIEW_PRIORITIES)[number];

export interface ReviewQueueItem {
    readonly id: string;
    readonly subject: ReviewSubject;
    readonly state: ReviewQueueState;
    readonly priority: ReviewPriority;
    readonly clientId: UserId;
    readonly clientDisplayName: string;
    /** The reasons the engine or the session raised, e.g. `energy_floor_applied`. */
    readonly reasons: readonly string[];
    readonly targetId: NutritionTargetId | null;
    readonly planId: MealPlanId | null;
    readonly sessionId: VdSessionId | null;
    readonly requestedAt: IsoDateTime;
    readonly assignedTo: DietitianId | null;
}

export interface ReviewDetail {
    readonly item: ReviewQueueItem;
    /** The stored target under review, when the subject is a nutrition target. */
    readonly target: StoredNutritionTarget | null;
    /** The plan week under review, when the subject is a meal plan. */
    readonly planWeek: MealPlanWeek | null;
    readonly clientNote: string | null;
    /** Everything the professional needs to see before deciding, in reading order. */
    readonly context: readonly string[];
}

export interface ApproveReviewRequest {
    readonly note?: string | undefined;
    /** Recorded against the professional's registration; shown to the client on the plan. */
    readonly signature: string;
}

export interface RequestChangesRequest {
    readonly note: string;
    /** Specific entries the professional wants changed. */
    readonly entryIds?: readonly MealPlanEntryId[] | undefined;
    readonly priority?: ReviewPriority | undefined;
}

export interface SetDietitianNoteRequest {
    readonly planId: MealPlanId;
    readonly note: string | null;
    /** Set to attach the note to one entry rather than the whole plan. */
    readonly entryId?: MealPlanEntryId | undefined;
}

export interface DietitianNote {
    readonly planId: MealPlanId;
    readonly entryId: MealPlanEntryId | null;
    readonly note: string | null;
    readonly authorId: DietitianId;
    readonly updatedAt: IsoDateTime;
}

/** A professional's replacement for a client's calculated target. */
export interface SetOverrideRequest {
    readonly clientId: UserId;
    readonly targetId: NutritionTargetId;
    readonly reason: string;
    readonly targetEnergy?: number | undefined;
    readonly macros?: readonly MacroTarget[] | undefined;
    readonly nutrients?: readonly NutrientTarget[] | undefined;
}

export interface ReviewQueueFilter extends CursorPageRequest {
    readonly states?: readonly ReviewQueueState[] | undefined;
    readonly subjects?: readonly ReviewSubject[] | undefined;
    readonly priority?: ReviewPriority | undefined;
    readonly assignedToMe?: boolean | undefined;
}

export interface ProfessionalRepository {
    listReviewQueue(filter?: ReviewQueueFilter): Promise<CursorPage<ReviewQueueItem>>;
    getReview(reviewId: string): Promise<ReviewDetail>;

    approve(reviewId: string, request: ApproveReviewRequest): Promise<ReviewQueueItem>;
    requestChanges(reviewId: string, request: RequestChangesRequest): Promise<ReviewQueueItem>;

    /** The client's plan for a week, as the professional sees it. */
    getClientPlan(clientId: UserId, planId: MealPlanId, weekStart: string): Promise<MealPlanWeek>;

    setDietitianNote(request: SetDietitianNoteRequest): Promise<DietitianNote>;

    /** Replaces a client's calculated target with the professional's own figures. */
    setOverride(request: SetOverrideRequest): Promise<StoredNutritionTarget>;
}

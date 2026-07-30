import type { DietitianId, IsoDateTime, NutritionTargetId } from '@healthy360/domain-types';
import type {
    NutritionTargetRequest,
    NutritionTargetResult,
    ProfessionalOverride,
} from '@healthy360/nutrition';

/**
 * The nutrition-target contract (Prompt 2, "Nutrition-target page").
 *
 * **Proposed, not implemented.** The calculation itself lives in `@healthy360/nutrition`, behind
 * `NutritionTargetEngine`; this repository is the *storage and review* seam around it. Keeping the
 * two apart is deliberate: the mock repository calls the prototype engine, and the API repository
 * will call none — it will read whatever the backend computed — and neither screen can tell.
 *
 * Every result the UI renders carries `prototype: true`, its method, its inputs and its citations.
 * Nothing here is medical advice, and `requestReview` exists so a person can reach somebody who is
 * qualified to give it.
 */

/** A stored target: an engine result plus the bookkeeping the backend adds. */
export interface StoredNutritionTarget {
    readonly id: NutritionTargetId;
    readonly result: NutritionTargetResult;
    /** True once a dietitian has approved this exact figure. */
    readonly professionallyApproved: boolean;
    readonly approvedBy: DietitianId | null;
    readonly approvedAt: IsoDateTime | null;
    readonly createdAt: IsoDateTime;
    readonly updatedAt: IsoDateTime;
}

/** `PUT /api/v1/nutrition/targets/current` — accepting or hand-adjusting a calculated target. */
export interface UpdateNutritionTargetRequest {
    /** The request the accepted figures were calculated from. */
    readonly source: NutritionTargetRequest;
    /** A manual energy figure. Omitted, the calculated one stands. */
    readonly targetEnergy?: number | undefined;
    /** A dietitian's replacement, when a professional is making the change. */
    readonly professionalOverride?: ProfessionalOverride | undefined;
    /** Recorded so the UI can prove the person saw the disclaimer before accepting. */
    readonly acknowledgedDisclaimer: boolean;
}

export const REVIEW_URGENCIES = ['routine', 'soon', 'urgent'] as const;
export type ReviewUrgency = (typeof REVIEW_URGENCIES)[number];

export interface RequestNutritionReviewRequest {
    readonly targetId: NutritionTargetId;
    /** A preferred dietitian, when the person has one. */
    readonly dietitianId?: DietitianId | undefined;
    readonly note?: string | undefined;
    readonly urgency?: ReviewUrgency | undefined;
}

export const NUTRITION_REVIEW_STATES = [
    'requested',
    'in_review',
    'changes_requested',
    'approved',
    'declined',
] as const;
export type NutritionReviewState = (typeof NUTRITION_REVIEW_STATES)[number];

export interface NutritionReview {
    readonly id: string;
    readonly targetId: NutritionTargetId;
    readonly state: NutritionReviewState;
    readonly dietitianId: DietitianId | null;
    readonly requestedAt: IsoDateTime;
    readonly respondedAt: IsoDateTime | null;
    readonly note: string | null;
}

export interface NutritionRepository {
    /**
     * `POST /api/v1/nutrition/calculate-targets` — a pure calculation. It stores nothing, so the
     * calculator on the public marketplace can call it without a session.
     */
    calculateTargets(request: NutritionTargetRequest): Promise<NutritionTargetResult>;

    /** `GET /api/v1/nutrition/targets/current`. `null` before onboarding has produced one. */
    getCurrentTargets(): Promise<StoredNutritionTarget | null>;

    /** `PUT /api/v1/nutrition/targets/current`. */
    updateCurrentTargets(request: UpdateNutritionTargetRequest): Promise<StoredNutritionTarget>;

    /** Asks a qualified dietitian to look at the stored target. */
    requestReview(request: RequestNutritionReviewRequest): Promise<NutritionReview>;
}

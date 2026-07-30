import type {
    AllergenCode,
    DietitianId,
    IsoDateTime,
    KitchenId,
    MealPlanId,
    Money,
    VdMessageId,
    VdSessionId,
    VdSessionState,
} from '@healthy360/domain-types';
import type { MacroTarget, NutrientTarget, NutritionTargetResult } from '@healthy360/nutrition';

import type { CursorPage, CursorPageRequest } from './pagination.ts';
import type { PreparationMode } from './planner.ts';

/**
 * The Virtual Dietitian contract (Prompt 2, "Virtual dietitian experience").
 *
 * **Proposed, not implemented. No language model is connected in this phase**, and the contract is
 * shaped so that connecting one later changes nothing above this line.
 *
 * Three properties are load-bearing rather than decorative:
 *
 * - `VdMessage.origin` marks every machine-authored message. An AI suggestion that cannot be
 *   distinguished from a professional's advice is the single most damaging thing this feature
 *   could ship.
 * - `VdProposal.acceptedAt` / `overriddenAt` record what the *person* decided, separately from
 *   what was proposed.
 * - `state` is one of twelve, including four blocked outcomes. Every one has a designed screen;
 *   a state with no screen is how a conversational flow acquires a dead end.
 *
 * The journey never presents itself as medical care. `safety_escalation` exists precisely so it can
 * stop and hand over.
 */

export const VD_MESSAGE_ORIGINS = ['user', 'assistant', 'system', 'dietitian'] as const;
export type VdMessageOrigin = (typeof VD_MESSAGE_ORIGINS)[number];

export interface VdMessage {
    readonly id: VdMessageId;
    readonly sessionId: VdSessionId;
    readonly origin: VdMessageOrigin;
    readonly body: string;
    /** True for anything machine-generated. Rendered as a visible label, not a tooltip. */
    readonly aiGenerated: boolean;
    /** Structured answers collected by this turn, keyed by question id. */
    readonly collected: Readonly<Record<string, string | number | boolean>> | null;
    readonly sentAt: IsoDateTime;
}

/** Something the interview still needs before it can propose anything. */
export interface VdMissingInformation {
    readonly field: string;
    readonly question: string;
    readonly required: boolean;
}

export interface VdConstraintConflict {
    /** The planner constraint id that could not be satisfied. */
    readonly constraintId: string;
    readonly label: string;
    readonly explanation: string;
    /** `true` when only a dietitian can resolve it. */
    readonly requiresProfessional: boolean;
}

export interface VdMealStructureSlot {
    readonly mealType: string;
    /** `HH:mm`, the person's local time. */
    readonly time: string | null;
    readonly energyShare: number;
    readonly preparationMode: PreparationMode;
}

export interface VdProposal {
    /** The targets the session is proposing, from the prototype engine. */
    readonly targets: NutritionTargetResult | null;
    readonly macros: readonly MacroTarget[];
    readonly nutrients: readonly NutrientTarget[];
    readonly mealStructure: readonly VdMealStructureSlot[];
    /** Plain-language reasoning shown beside the proposal. */
    readonly rationale: readonly string[];
    readonly assumptions: readonly string[];
    /** Set once the person accepts. */
    readonly acceptedAt: IsoDateTime | null;
    /** Set when a human replaced part of the proposal. */
    readonly overriddenAt: IsoDateTime | null;
    readonly overriddenBy: DietitianId | null;
}

export interface VdSafetyNotice {
    readonly code: string;
    readonly severity: 'information' | 'warning' | 'escalation';
    readonly message: string;
    /** Allergens the session identified as needing an explicit warning. */
    readonly allergens: readonly AllergenCode[];
}

export interface VdSession {
    readonly id: VdSessionId;
    readonly state: VdSessionState;
    readonly messages: readonly VdMessage[];
    readonly missingInformation: readonly VdMissingInformation[];
    readonly conflicts: readonly VdConstraintConflict[];
    readonly proposal: VdProposal | null;
    readonly safetyNotices: readonly VdSafetyNotice[];
    /** The draft plan, once one has been generated. */
    readonly draftPlanId: MealPlanId | null;
    readonly reviewRequestedAt: IsoDateTime | null;
    readonly reviewedBy: DietitianId | null;
    readonly approvedAt: IsoDateTime | null;
    /** Fixed translated wording; rendered on every state. */
    readonly disclaimer: string;
    readonly createdAt: IsoDateTime;
    readonly updatedAt: IsoDateTime;
}

export interface VdSessionSummary {
    readonly id: VdSessionId;
    readonly state: VdSessionState;
    readonly headline: string;
    readonly updatedAt: IsoDateTime;
}

export interface CreateVdSessionRequest {
    readonly preparationMode?: PreparationMode | undefined;
    readonly preferredKitchenIds?: readonly KitchenId[] | undefined;
    readonly weeklyBudget?: Money | undefined;
    /** Delivery area, so the session can rule out kitchens that cannot reach the person. */
    readonly deliveryArea?: string | undefined;
    /** Seeds the interview from the stored profile rather than starting from nothing. */
    readonly useProfile?: boolean | undefined;
}

export interface SendVdMessageRequest {
    readonly body: string;
    /** Structured answers to the questions the session asked. */
    readonly answers?: Readonly<Record<string, string | number | boolean>> | undefined;
}

export interface GenerateVdDraftRequest {
    readonly weekStart: string;
    readonly preparationMode?: PreparationMode | undefined;
    readonly acknowledgedDisclaimer: boolean;
}

export interface RequestVdReviewRequest {
    readonly dietitianId?: DietitianId | undefined;
    readonly note?: string | undefined;
}

export interface AcceptVdProposalRequest {
    /** Recorded so the UI can prove the person saw the disclaimer before accepting. */
    readonly acknowledgedDisclaimer: boolean;
    readonly note?: string | undefined;
}

export interface OverrideVdProposalRequest {
    readonly reason: string;
    readonly targetEnergy?: number | undefined;
    readonly macros?: readonly MacroTarget[] | undefined;
    readonly mealStructure?: readonly VdMealStructureSlot[] | undefined;
}

export interface VirtualDietitianRepository {
    /** `POST /api/v1/virtual-dietitian/sessions`. */
    createSession(request?: CreateVdSessionRequest): Promise<VdSession>;
    getSession(sessionId: VdSessionId): Promise<VdSession>;
    listSessions(request?: CursorPageRequest): Promise<CursorPage<VdSessionSummary>>;

    /** `POST /api/v1/virtual-dietitian/sessions/{session}/messages`. */
    sendMessage(sessionId: VdSessionId, request: SendVdMessageRequest): Promise<VdSession>;

    /** `POST .../generate-draft`. May resolve into any of the four blocked states. */
    generateDraft(sessionId: VdSessionId, request: GenerateVdDraftRequest): Promise<VdSession>;

    /** `POST .../request-review` — hands the session to a qualified dietitian. */
    requestReview(sessionId: VdSessionId, request?: RequestVdReviewRequest): Promise<VdSession>;

    /** Records the person's acceptance of the proposal, with the disclaimer acknowledgement. */
    acceptProposal(sessionId: VdSessionId, request: AcceptVdProposalRequest): Promise<VdSession>;

    /** Human override of a machine proposal, by the person or by their dietitian. */
    overrideProposal(
        sessionId: VdSessionId,
        request: OverrideVdProposalRequest,
    ): Promise<VdSession>;
}

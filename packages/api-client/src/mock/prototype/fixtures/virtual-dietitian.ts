import { VD_SESSION_STATES } from '@healthy360/domain-types';
import type {
    IsoDateTime,
    MealPlanId,
    VdSessionId,
    VdSessionState,
} from '@healthy360/domain-types';

import type {
    VdConstraintConflict,
    VdMealStructureSlot,
    VdMessage,
    VdMessageOrigin,
    VdMissingInformation,
    VdProposal,
    VdSafetyNotice,
    VdSession,
} from '../../../contracts/virtual-dietitian.ts';
import { PROTOTYPE_NOW, atOrThrow, fromMapOrThrow, instantAt } from '../constants.ts';
import { vdMessageIdAt, vdSessionIdAt } from '../ids.ts';
import {
    PROTOTYPE_NUTRIENT_TARGETS,
    PROTOTYPE_ONBOARDING,
    PROTOTYPE_TARGET_RESULT,
} from './customer.ts';
import { dietitianByKey } from './dietitians.ts';
import { PROTOTYPE_PLAN_IDS } from './planner.ts';

/**
 * The Virtual Dietitian: one complete conversation, plus a session sitting in every one of the
 * twelve states.
 *
 * **No language model is connected, and the shape of this file is the reason that is safe.** Every
 * assistant turn below is a written script keyed to a state; the store walks the script rather than
 * generating anything. When a model is connected later, it replaces the script and nothing above the
 * repository changes.
 *
 * Three properties are enforced here rather than left to a screen:
 *
 * - Every machine-authored message carries `aiGenerated: true` and an `origin` of `assistant`. A
 *   dietitian's message carries `origin: 'dietitian'` and `aiGenerated: false`. Nothing renders the
 *   two the same way, because nothing can confuse them.
 * - `disclaimer` is present on **every** session in **every** state, including the failures.
 * - `safety_escalation` is reachable, deterministic, and stops the journey rather than working
 *   around it.
 */

export const VD_DISCLAIMER =
    'The Virtual Dietitian is an automated assistant, not a clinician. It does not diagnose, treat ' +
    'or prescribe, and it is not a substitute for care from a qualified dietitian or doctor. ' +
    'Anything it suggests should be checked by a professional before you act on it.';

/**
 * Inputs that stop the interview and hand over to a person.
 *
 * A deliberately small, explicit list. A conversational feature that tries to *infer* distress is a
 * feature that will get it wrong in both directions; this one escalates on stated markers and says
 * plainly that it is doing so.
 */
export const VD_SAFETY_MARKERS: readonly string[] = [
    'self-harm',
    'harm myself',
    'stop eating entirely',
    'purge',
    'not eaten for days',
];

export function detectSafetyMarker(text: string): string | null {
    const haystack = text.toLowerCase();
    return VD_SAFETY_MARKERS.find((marker) => haystack.includes(marker)) ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Builders
 * ---------------------------------------------------------------------------------------------- */

export interface MakeVdMessageOptions {
    readonly ordinal: number;
    readonly sessionId: VdSessionId;
    readonly origin: VdMessageOrigin;
    readonly body: string;
    readonly collected?: VdMessage['collected'] | undefined;
    readonly sentAt?: IsoDateTime | undefined;
}

export function makeVdMessage(options: MakeVdMessageOptions): VdMessage {
    return {
        id: vdMessageIdAt(options.ordinal),
        sessionId: options.sessionId,
        origin: options.origin,
        body: options.body,
        // The single rule the whole feature rests on: machine authorship is a property of the
        // message, not a styling decision taken later.
        aiGenerated: options.origin === 'assistant',
        collected: options.collected ?? null,
        sentAt: options.sentAt ?? PROTOTYPE_NOW,
    };
}

/** The meal structure the session proposes, from the onboarding answers. */
export function makeMealStructure(): readonly VdMealStructureSlot[] {
    const shares: Readonly<Record<string, number>> = {
        breakfast: 0.25,
        lunch: 0.3,
        snack: 0.1,
        dinner: 0.35,
    };
    return PROTOTYPE_ONBOARDING.mealSlots.map((slot) => ({
        mealType: slot.mealType,
        time: slot.time,
        energyShare: shares[slot.mealType] ?? 0.25,
        preparationMode:
            slot.mealType === 'lunch' ? ('kitchen_prepared' as const) : ('home_prepared' as const),
    }));
}

export interface MakeVdProposalOverrides {
    readonly acceptedAt?: IsoDateTime | null | undefined;
    readonly overriddenAt?: IsoDateTime | null | undefined;
    readonly overriddenBy?: VdProposal['overriddenBy'] | undefined;
    readonly mealStructure?: readonly VdMealStructureSlot[] | undefined;
}

export function makeVdProposal(overrides: MakeVdProposalOverrides = {}): VdProposal {
    return {
        targets: PROTOTYPE_TARGET_RESULT,
        macros: PROTOTYPE_TARGET_RESULT.macros,
        nutrients: PROTOTYPE_NUTRIENT_TARGETS,
        mealStructure: overrides.mealStructure ?? makeMealStructure(),
        rationale: [
            'Maintenance energy was estimated from your height, weight, age and stated activity, ' +
                'then moved by a bounded percentage for the goal and pace you chose.',
            'Protein is set per kilogram of body mass rather than as a share of energy, so it stays ' +
                'stable if the energy target changes.',
            'Lunch is proposed as kitchen-prepared because your stated cooking time on weekdays is ' +
                'thirty minutes or less.',
        ],
        assumptions: PROTOTYPE_TARGET_RESULT.explanation.assumptions,
        acceptedAt: overrides.acceptedAt ?? null,
        overriddenAt: overrides.overriddenAt ?? null,
        overriddenBy: overrides.overriddenBy ?? null,
    };
}

const MISSING_BUDGET: VdMissingInformation = {
    field: 'weeklyBudget',
    question: 'Roughly what would you like to spend on food in a week?',
    required: true,
};

const MISSING_DELIVERY_AREA: VdMissingInformation = {
    field: 'deliveryArea',
    question: 'Which area should kitchen-prepared meals be delivered to?',
    required: false,
};

const CONFLICT_NUT_FREE_HIGH_PROTEIN: VdConstraintConflict = {
    constraintId: 'allergies',
    label: 'Tree nuts against a plant-based high-protein target',
    explanation:
        'With tree nuts excluded and dairy limited, the plant-based options left cannot reach the ' +
        'proposed protein figure at this energy target without repeating the same three dishes.',
    requiresProfessional: true,
};

const SAFETY_ALLERGEN_NOTICE: VdSafetyNotice = {
    code: 'vd.allergen_declared',
    severity: 'warning',
    message:
        'Tree nuts are excluded from everything suggested here. Check the allergen list on any ' +
        'meal before you eat it, including ones you have eaten before.',
    allergens: [],
};

const SAFETY_ESCALATION_NOTICE: VdSafetyNotice = {
    code: 'vd.safety_escalation',
    severity: 'escalation',
    message:
        'This conversation has stopped. What you have described needs a person, not an automated ' +
        'assistant. Please contact your doctor or a qualified dietitian; if you are in immediate ' +
        'danger, contact your local emergency service.',
    allergens: [],
};

export interface MakeVdSessionOverrides {
    readonly messages?: readonly VdMessage[] | undefined;
    readonly missingInformation?: readonly VdMissingInformation[] | undefined;
    readonly conflicts?: readonly VdConstraintConflict[] | undefined;
    readonly proposal?: VdProposal | null | undefined;
    readonly safetyNotices?: readonly VdSafetyNotice[] | undefined;
    readonly draftPlanId?: MealPlanId | null | undefined;
    readonly reviewRequestedAt?: IsoDateTime | null | undefined;
    readonly reviewedBy?: VdSession['reviewedBy'] | undefined;
    readonly approvedAt?: IsoDateTime | null | undefined;
    readonly updatedAt?: IsoDateTime | undefined;
}

export function makeVdSession(
    id: VdSessionId,
    state: VdSessionState,
    overrides: MakeVdSessionOverrides = {},
): VdSession {
    return {
        id,
        state,
        messages: overrides.messages ?? [],
        missingInformation: overrides.missingInformation ?? [],
        conflicts: overrides.conflicts ?? [],
        proposal: overrides.proposal ?? null,
        safetyNotices: overrides.safetyNotices ?? [],
        draftPlanId: overrides.draftPlanId ?? null,
        reviewRequestedAt: overrides.reviewRequestedAt ?? null,
        reviewedBy: overrides.reviewedBy ?? null,
        approvedAt: overrides.approvedAt ?? null,
        disclaimer: VD_DISCLAIMER,
        createdAt: PROTOTYPE_NOW,
        updatedAt: overrides.updatedAt ?? PROTOTYPE_NOW,
    };
}

/* ------------------------------------------------------------------------------------------------
 * The scripted assistant
 * ---------------------------------------------------------------------------------------------- */

/**
 * What the assistant says on arriving in each state, and what a person says to get there.
 *
 * The store reads this table; nothing is generated. `progression` is the order the happy path walks
 * — one user turn moves the session one step — and the four blocked states are reached by their own
 * triggers rather than by taking another turn.
 */
export const VD_ASSISTANT_SCRIPT: Readonly<Record<VdSessionState, string>> = {
    initial_interview:
        'Before anything else: I am an automated assistant, not a clinician. To suggest a starting ' +
        'point I need your height, weight, age, how active you usually are, and what you are aiming ' +
        'for. You can change any of it later.',
    analysing:
        'Thank you. Working through what you have told me: your stated activity level, your goal ' +
        'and pace, the restrictions on your profile, and the meal times you gave.',
    missing_information:
        'One thing is missing before I can suggest anything sensible: a rough weekly budget. ' +
        'Without it I would be proposing meals you may not want to buy.',
    suggested_targets:
        'Here is a starting point, with the arithmetic shown. Every figure comes from published ' +
        'equations, and none of it is medical advice — a dietitian should check it before you follow it.',
    suggested_meal_structure:
        'Now the shape of the day. Three meals and a snack, with lunch kitchen-prepared because you ' +
        'said you have half an hour or less on weekdays.',
    draft_generated:
        'A draft week is ready. Nothing is locked, nothing has been ordered, and every suggestion ' +
        'in it is machine-generated and marked as such.',
    review_requested:
        'Your plan has been sent to a qualified dietitian. You will be told when they have looked ' +
        'at it. Nothing changes in the meantime.',
    professionally_approved:
        'A dietitian has reviewed and approved this plan. Their note is on the plan itself, and ' +
        'their name is against the entries they signed off.',
    generation_failed:
        'I could not build a week from what is available. This is a fault on our side, not ' +
        'something you did — nothing has been changed, and you can try again.',
    restriction_conflict:
        'Two of your restrictions cannot both be satisfied at this energy target. I have stopped ' +
        'rather than quietly dropping one of them; a dietitian can resolve it.',
    no_suitable_meals:
        'Nothing in the kitchens that deliver to your area fits these restrictions this week. ' +
        'Widening the delivery area or allowing home-prepared meals would give me something to work with.',
    safety_escalation:
        'I am stopping this conversation here. What you have described needs a person, not an ' +
        'automated assistant, and I am not able to help with it safely.',
};

/** The happy path, in order. `sendMessage` advances one step per user turn. */
export const VD_PROGRESSION: readonly VdSessionState[] = [
    'initial_interview',
    'analysing',
    'missing_information',
    'suggested_targets',
    'suggested_meal_structure',
];

/* ------------------------------------------------------------------------------------------------
 * The complete conversation, and one session per state
 * ---------------------------------------------------------------------------------------------- */

const APPROVED_SESSION_ID = vdSessionIdAt(0);

/** The full conversation, from the opening disclaimer to a dietitian's sign-off. */
export const PROTOTYPE_VD_CONVERSATION: readonly VdMessage[] = [
    makeVdMessage({
        ordinal: 0,
        sessionId: APPROVED_SESSION_ID,
        origin: 'system',
        body: VD_DISCLAIMER,
        sentAt: instantAt('2026-07-24', '09:00'),
    }),
    makeVdMessage({
        ordinal: 1,
        sessionId: APPROVED_SESSION_ID,
        origin: 'assistant',
        body: VD_ASSISTANT_SCRIPT.initial_interview,
        sentAt: instantAt('2026-07-24', '09:00'),
    }),
    makeVdMessage({
        ordinal: 2,
        sessionId: APPROVED_SESSION_ID,
        origin: 'user',
        body: 'I am 34, 165 cm, 68 kg, and I train three times a week. I want to lose weight steadily, not quickly.',
        collected: {
            ageYears: 34,
            heightCentimetres: 165,
            weightKilograms: 68,
            activityLevel: 'moderately_active',
            goal: 'lose_weight',
            pace: 'standard',
        },
        sentAt: instantAt('2026-07-24', '09:02'),
    }),
    makeVdMessage({
        ordinal: 3,
        sessionId: APPROVED_SESSION_ID,
        origin: 'assistant',
        body:
            'Understood. Your profile already records a tree-nut allergy, a lactose intolerance, a ' +
            'sodium ceiling you recorded yourself, and an added-sugar limit set by your dietitian. ' +
            'Should I treat all four as fixed?',
        sentAt: instantAt('2026-07-24', '09:02'),
    }),
    makeVdMessage({
        ordinal: 4,
        sessionId: APPROVED_SESSION_ID,
        origin: 'user',
        body: 'Yes, all four. I also do not eat pork, and I would rather not see aubergine.',
        collected: { confirmRestrictions: true },
        sentAt: instantAt('2026-07-24', '09:04'),
    }),
    makeVdMessage({
        ordinal: 5,
        sessionId: APPROVED_SESSION_ID,
        origin: 'assistant',
        body: VD_ASSISTANT_SCRIPT.analysing,
        sentAt: instantAt('2026-07-24', '09:04'),
    }),
    makeVdMessage({
        ordinal: 6,
        sessionId: APPROVED_SESSION_ID,
        origin: 'assistant',
        body: VD_ASSISTANT_SCRIPT.missing_information,
        sentAt: instantAt('2026-07-24', '09:05'),
    }),
    makeVdMessage({
        ordinal: 7,
        sessionId: APPROVED_SESSION_ID,
        origin: 'user',
        body: 'About 450 dirhams a week, and deliveries to Business Bay.',
        collected: { weeklyBudgetMinorUnits: 45000, deliveryArea: 'Business Bay' },
        sentAt: instantAt('2026-07-24', '09:06'),
    }),
    makeVdMessage({
        ordinal: 8,
        sessionId: APPROVED_SESSION_ID,
        origin: 'assistant',
        body: VD_ASSISTANT_SCRIPT.suggested_targets,
        sentAt: instantAt('2026-07-24', '09:06'),
    }),
    makeVdMessage({
        ordinal: 9,
        sessionId: APPROVED_SESSION_ID,
        origin: 'user',
        body: 'That looks reasonable. I have read the disclaimer — go on.',
        collected: { acknowledgedDisclaimer: true, acceptedTargets: true },
        sentAt: instantAt('2026-07-24', '09:09'),
    }),
    makeVdMessage({
        ordinal: 10,
        sessionId: APPROVED_SESSION_ID,
        origin: 'assistant',
        body: VD_ASSISTANT_SCRIPT.suggested_meal_structure,
        sentAt: instantAt('2026-07-24', '09:09'),
    }),
    makeVdMessage({
        ordinal: 11,
        sessionId: APPROVED_SESSION_ID,
        origin: 'assistant',
        body: VD_ASSISTANT_SCRIPT.draft_generated,
        sentAt: instantAt('2026-07-24', '09:11'),
    }),
    makeVdMessage({
        ordinal: 12,
        sessionId: APPROVED_SESSION_ID,
        origin: 'user',
        body: 'Please have a dietitian look at it before I start.',
        sentAt: instantAt('2026-07-25', '08:30'),
    }),
    makeVdMessage({
        ordinal: 13,
        sessionId: APPROVED_SESSION_ID,
        origin: 'dietitian',
        body:
            'I have gone through the week. The energy and protein figures are appropriate for what ' +
            'you described, and the tree-nut exclusion is clean. I have raised Thursday’s dinner ' +
            'protein slightly and signed that entry off. Come back to me if the sodium ceiling ' +
            'turns out to be hard to keep to.',
        sentAt: instantAt('2026-07-26', '11:15'),
    }),
];

type SessionRow = readonly [
    state: VdSessionState,
    ordinal: number,
    /** Extra turns appended after the shared opening. */
    turns: readonly (readonly [VdMessageOrigin, string])[],
];

/**
 * One session per state.
 *
 * Every state gets its own session rather than one session that can be pushed around, because a
 * screen has to be able to render any of the twelve from a cold start — that is the whole point of
 * enumerating them.
 */
const SESSION_ROWS: readonly SessionRow[] = [
    ['initial_interview', 1, []],
    [
        'analysing',
        2,
        [['user', 'I am 34, 165 cm and 68 kg, moderately active, aiming to lose weight steadily.']],
    ],
    ['missing_information', 3, [['user', 'Whatever you think is best, really.']]],
    ['suggested_targets', 4, [['user', 'About 450 dirhams a week.']]],
    ['suggested_meal_structure', 5, [['user', 'Those targets look fine to me.']]],
    ['draft_generated', 6, [['user', 'Yes — build me the week.']]],
    ['review_requested', 7, [['user', 'Please have a dietitian look at it first.']]],
    ['generation_failed', 8, [['user', 'Go ahead and generate it.']]],
    [
        'restriction_conflict',
        9,
        [['user', 'I would like it entirely plant-based as well, with no soy.']],
    ],
    ['no_suitable_meals', 10, [['user', 'Kitchen-prepared only, delivered to Sharjah.']]],
    [
        'safety_escalation',
        11,
        [['user', 'Honestly I have been thinking about stopping eating entirely.']],
    ],
];

/** Message ordinals for the per-state sessions start above the complete conversation's. */
const PER_STATE_MESSAGE_BASE = 20;

function buildStateSession(row: SessionRow, index: number): VdSession {
    const [state, ordinal, turns] = row;
    const id = vdSessionIdAt(ordinal);
    let messageOrdinal = PER_STATE_MESSAGE_BASE + index * 6;

    const messages: VdMessage[] = [
        makeVdMessage({
            ordinal: messageOrdinal++,
            sessionId: id,
            origin: 'system',
            body: VD_DISCLAIMER,
        }),
        makeVdMessage({
            ordinal: messageOrdinal++,
            sessionId: id,
            origin: 'assistant',
            body: VD_ASSISTANT_SCRIPT.initial_interview,
        }),
    ];

    for (const [origin, body] of turns) {
        messages.push(makeVdMessage({ ordinal: messageOrdinal++, sessionId: id, origin, body }));
    }

    if (state !== 'initial_interview') {
        messages.push(
            makeVdMessage({
                ordinal: messageOrdinal,
                sessionId: id,
                origin: 'assistant',
                body: VD_ASSISTANT_SCRIPT[state],
            }),
        );
    }

    const proposal =
        state === 'suggested_targets' ||
        state === 'suggested_meal_structure' ||
        state === 'draft_generated' ||
        state === 'review_requested'
            ? makeVdProposal(
                  state === 'suggested_targets'
                      ? {}
                      : { acceptedAt: instantAt('2026-07-24', '09:09') },
              )
            : null;

    return makeVdSession(id, state, {
        messages,
        missingInformation:
            state === 'missing_information' ? [MISSING_BUDGET, MISSING_DELIVERY_AREA] : [],
        conflicts: state === 'restriction_conflict' ? [CONFLICT_NUT_FREE_HIGH_PROTEIN] : [],
        proposal,
        safetyNotices:
            state === 'safety_escalation'
                ? [SAFETY_ESCALATION_NOTICE]
                : state === 'draft_generated' || state === 'review_requested'
                  ? [SAFETY_ALLERGEN_NOTICE]
                  : [],
        draftPlanId:
            state === 'draft_generated' || state === 'review_requested'
                ? PROTOTYPE_PLAN_IDS.draft
                : null,
        reviewRequestedAt: state === 'review_requested' ? instantAt('2026-07-25', '08:30') : null,
    });
}

/** The approved session: the complete conversation, a signed-off plan and an accepted proposal. */
export const PROTOTYPE_VD_APPROVED_SESSION: VdSession = makeVdSession(
    APPROVED_SESSION_ID,
    'professionally_approved',
    {
        messages: PROTOTYPE_VD_CONVERSATION,
        proposal: makeVdProposal({ acceptedAt: instantAt('2026-07-24', '09:09') }),
        safetyNotices: [SAFETY_ALLERGEN_NOTICE],
        draftPlanId: PROTOTYPE_PLAN_IDS.week,
        reviewRequestedAt: instantAt('2026-07-25', '08:30'),
        reviewedBy: dietitianByKey('layla_haddad').id,
        approvedAt: instantAt('2026-07-26', '11:15'),
        updatedAt: instantAt('2026-07-26', '11:15'),
    },
);

export const PROTOTYPE_VD_SESSIONS: readonly VdSession[] = [
    PROTOTYPE_VD_APPROVED_SESSION,
    ...SESSION_ROWS.map(buildStateSession),
];

const BY_STATE: ReadonlyMap<VdSessionState, VdSession> = new Map(
    PROTOTYPE_VD_SESSIONS.map((session) => [session.state, session]),
);

export function vdSessionForState(state: VdSessionState): VdSession {
    return fromMapOrThrow(BY_STATE, state, 'Virtual Dietitian session');
}

export function vdSessionAt(index: number): VdSession {
    return atOrThrow(PROTOTYPE_VD_SESSIONS, index, 'Virtual Dietitian session');
}

/** Every state has a session. Asserted by the test; stated here so the omission is visible. */
export const VD_COVERED_STATES: readonly VdSessionState[] = VD_SESSION_STATES.filter((state) =>
    BY_STATE.has(state),
);

export const VD_MISSING_INFORMATION_FIXTURES: readonly VdMissingInformation[] = [
    MISSING_BUDGET,
    MISSING_DELIVERY_AREA,
];

export const VD_CONFLICT_FIXTURE: VdConstraintConflict = CONFLICT_NUT_FREE_HIGH_PROTEIN;
export const VD_ALLERGEN_NOTICE: VdSafetyNotice = SAFETY_ALLERGEN_NOTICE;
export const VD_ESCALATION_NOTICE: VdSafetyNotice = SAFETY_ESCALATION_NOTICE;

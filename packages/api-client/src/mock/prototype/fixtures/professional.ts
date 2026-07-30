import type { DietitianId, IsoDateTime } from '@healthy360/domain-types';

import type {
    DietitianNote,
    ReviewPriority,
    ReviewQueueItem,
    ReviewQueueState,
    ReviewSubject,
} from '../../../contracts/professional.ts';
import { PROTOTYPE_NOW, atOrThrow } from '../constants.ts';
import { reviewIdAt } from '../ids.ts';
import {
    PROTOTYPE_CUSTOMER_ID,
    PROTOTYPE_CUSTOMER_NAME,
    PROTOTYPE_STORED_TARGET,
    PROTOTYPE_TARGET_RESULT,
} from './customer.ts';
import { dietitianByKey } from './dietitians.ts';
import { PROTOTYPE_PLAN_IDS } from './planner.ts';
import { vdSessionForState } from './virtual-dietitian.ts';

/**
 * The dietitian's queue.
 *
 * Every item here exists because something upstream raised a flag: the target engine set
 * `requiresProfessionalReview`, a Virtual Dietitian session hit a restriction conflict, or the
 * person asked for a human to look at their week. That is the point of the queue — if these flags
 * arrive nowhere, they are decoration, and the product's safety story is a claim rather than a path.
 *
 * The reasons on the first item are **the engine's own**, not a written list: whatever
 * `MockNutritionTargetEngine` decided to flag is what the professional sees.
 */

type ReviewRow = readonly [
    ordinal: number,
    subject: ReviewSubject,
    state: ReviewQueueState,
    priority: ReviewPriority,
    reasons: readonly string[],
    withTarget: boolean,
    withPlan: boolean,
    /** The Virtual Dietitian state whose session this item is about, when it is about one. */
    sessionState: 'restriction_conflict' | 'review_requested' | null,
    assignedToKey: string | null,
    requestedAt: IsoDateTime,
];

const ROWS: readonly ReviewRow[] = [
    [
        0,
        'nutrition_target',
        'awaiting_review',
        'soon',
        PROTOTYPE_TARGET_RESULT.reviewReasons,
        true,
        false,
        null,
        null,
        '2026-07-29T06:40:00.000Z',
    ],
    [
        1,
        'meal_plan',
        'in_review',
        'routine',
        ['allergen_exclusion_declared', 'sodium_ceiling_declared'],
        false,
        true,
        null,
        'layla_haddad',
        '2026-07-29T08:05:00.000Z',
    ],
    [
        2,
        'virtual_dietitian',
        'awaiting_review',
        'urgent',
        ['restriction_conflict', 'requires_professional_resolution'],
        false,
        false,
        'restriction_conflict',
        null,
        '2026-07-30T05:15:00.000Z',
    ],
    [
        3,
        'meal_plan',
        'approved',
        'routine',
        ['professional_sign_off'],
        false,
        true,
        'review_requested',
        'layla_haddad',
        '2026-07-25T08:30:00.000Z',
    ],
];

export interface MakeReviewQueueItemOverrides {
    readonly state?: ReviewQueueState | undefined;
    readonly priority?: ReviewPriority | undefined;
    readonly assignedTo?: DietitianId | null | undefined;
    readonly reasons?: readonly string[] | undefined;
}

export function makeReviewQueueItem(
    row: ReviewRow,
    overrides: MakeReviewQueueItemOverrides = {},
): ReviewQueueItem {
    const [
        ordinal,
        subject,
        state,
        priority,
        reasons,
        withTarget,
        withPlan,
        sessionState,
        assignedToKey,
        requestedAt,
    ] = row;

    return {
        id: reviewIdAt(ordinal),
        subject,
        state: overrides.state ?? state,
        priority: overrides.priority ?? priority,
        clientId: PROTOTYPE_CUSTOMER_ID,
        clientDisplayName: PROTOTYPE_CUSTOMER_NAME,
        reasons: overrides.reasons ?? reasons,
        targetId: withTarget ? PROTOTYPE_STORED_TARGET.id : null,
        planId: withPlan ? PROTOTYPE_PLAN_IDS.week : null,
        sessionId: sessionState === null ? null : vdSessionForState(sessionState).id,
        requestedAt,
        assignedTo:
            overrides.assignedTo === undefined
                ? assignedToKey === null
                    ? null
                    : dietitianByKey(assignedToKey).id
                : overrides.assignedTo,
    };
}

export const PROTOTYPE_REVIEW_QUEUE: readonly ReviewQueueItem[] = ROWS.map((row) =>
    makeReviewQueueItem(row),
);

export function reviewQueueItemAt(index: number): ReviewQueueItem {
    return atOrThrow(PROTOTYPE_REVIEW_QUEUE, index, 'review queue item');
}

/** Reading order for the professional: what they need before deciding, not a data dump. */
export const PROTOTYPE_REVIEW_CONTEXT: readonly string[] = [
    'Client declared a tree-nut allergy at onboarding. No entry in the week contains tree nuts except Monday breakfast, which is flagged.',
    'Client recorded a sodium ceiling themselves after a blood-pressure reading. It has not been confirmed clinically.',
    'An added-sugar limit is in force, set by this practice.',
    'Targets were produced by a prototype calculator from published equations. They are an estimate, not a clinical assessment.',
];

export const PROTOTYPE_CLIENT_NOTE =
    'I am happy with the week but Friday is a family dinner out and I could not work out what to do about it.';

export interface MakeDietitianNoteOverrides {
    readonly note?: string | null | undefined;
    readonly entryId?: DietitianNote['entryId'] | undefined;
    readonly updatedAt?: IsoDateTime | undefined;
}

export function makeDietitianNote(
    authorId: DietitianId,
    overrides: MakeDietitianNoteOverrides = {},
): DietitianNote {
    return {
        planId: PROTOTYPE_PLAN_IDS.week,
        entryId: overrides.entryId ?? null,
        note:
            overrides.note === undefined
                ? 'Energy and protein are appropriate for what you described. Keep an eye on the sodium ' +
                  'ceiling on the days with a kitchen meal at both lunch and dinner.'
                : overrides.note,
        authorId,
        updatedAt: overrides.updatedAt ?? PROTOTYPE_NOW,
    };
}

export const PROTOTYPE_DIETITIAN_NOTE: DietitianNote = makeDietitianNote(
    dietitianByKey('layla_haddad').id,
);

import type { BadgeTone } from '@healthy360/design-system';
import type {
    ReviewPriority,
    ReviewQueueState,
    ReviewSubject,
} from '@healthy360/api-client/contracts';
import type { RestrictionKind } from '@healthy360/domain-types';
import type { NutritionConstraint } from '@healthy360/nutrition';

/**
 * Presentation helpers for the dietitian's surfaces.
 *
 * Two of these carry a decision rather than a formatting preference.
 *
 * ## Priority is a colour *and* an icon, always
 *
 * `urgent` is not communicated by red alone. The badge tones below always pair with an icon at the
 * call site, because the queue is exactly the screen where colour-blind or low-contrast reading
 * would cost somebody a triage decision (`packages/design-system` makes the same rule global).
 *
 * ## A raw reason code is never rendered
 *
 * `ReviewQueueItem.reasons` carries engine codes such as `energy_floor_applied` and fixture codes
 * such as `sodium_ceiling_declared`. {@link reasonKey} maps each to a sentence; the call site passes
 * the code itself as the i18next `defaultValue`, so a code nobody has written copy for degrades to
 * the code rather than to a blank line. That is deliberate: a professional seeing `unknown_flag_7`
 * knows to ask; a professional seeing nothing does not know there was a flag.
 */

/** `professional:reasons.<code>`. Always called with the raw code as `defaultValue`. */
export function reasonKey(code: string): string {
    return `professional:reasons.${code}`;
}

/**
 * `professional:warnings.<code>` — a planner warning as a professional needs to read it.
 *
 * The consumer copy in `planner:warnings.codes.*` is addressed to the person eating the meal and
 * interpolates its name ("{{meal}} is a large share of your energy target"). A professional reading
 * a whole week needs the *class* of problem, not one sentence per card, so the codes get their own
 * short labels here. The `planner.` prefix is stripped because it is a namespace on the wire, not
 * part of the code's meaning.
 */
export function warningKey(code: string): string {
    return `professional:warnings.${code.replace(/^planner\./, '')}`;
}

/** `professional:subjects.<subject>`. */
export function subjectKey(subject: ReviewSubject): string {
    return `professional:subjects.${subject}`;
}

/** `professional:states.<state>`. */
export function queueStateKey(state: ReviewQueueState): string {
    return `professional:states.${state}`;
}

/** `professional:priorities.<priority>`. */
export function priorityKey(priority: ReviewPriority): string {
    return `professional:priorities.${priority}`;
}

export const PRIORITY_TONE: Readonly<Record<ReviewPriority, BadgeTone>> = {
    routine: 'neutral',
    soon: 'warning',
    urgent: 'danger',
};

export const PRIORITY_ICON: Readonly<Record<ReviewPriority, 'dot' | 'info' | 'warning'>> = {
    routine: 'dot',
    soon: 'info',
    urgent: 'warning',
};

export const QUEUE_STATE_TONE: Readonly<Record<ReviewQueueState, BadgeTone>> = {
    awaiting_review: 'info',
    in_review: 'info',
    changes_requested: 'warning',
    approved: 'success',
    declined: 'neutral',
};

/**
 * A review is still open when nobody has decided it.
 *
 * `changes_requested` counts as decided: the professional has acted and the ball is with the client.
 * Treating it as open would keep it in the triage list forever.
 */
export function isOpenReview(state: ReviewQueueState): boolean {
    return state === 'awaiting_review' || state === 'in_review';
}

/**
 * Constraints a professional set, which only a professional may lift.
 *
 * Kept apart from everything the client declared because the two carry different authority: a client
 * can change their own dislikes, and cannot change this. The review detail renders the group
 * separately for that reason rather than merging seven kinds into one list.
 */
export function enforcedConstraints(
    constraints: readonly NutritionConstraint[] | undefined,
): readonly NutritionConstraint[] {
    return (constraints ?? []).filter((constraint) => constraint.kind === 'dietitian_enforced');
}

/** Everything else, in the order the restriction taxonomy declares. */
export function declaredConstraints(
    constraints: readonly NutritionConstraint[] | undefined,
): readonly NutritionConstraint[] {
    return (constraints ?? []).filter((constraint) => constraint.kind !== 'dietitian_enforced');
}

/** `professional:restrictionKinds.<kind>` — never a raw enum member on screen. */
export function restrictionKindKey(kind: RestrictionKind): string {
    return `professional:restrictionKinds.${kind}`;
}

export const SEVERITY_TONE: Readonly<Record<NutritionConstraint['severity'], BadgeTone>> = {
    advisory: 'neutral',
    strict: 'warning',
    critical: 'danger',
};

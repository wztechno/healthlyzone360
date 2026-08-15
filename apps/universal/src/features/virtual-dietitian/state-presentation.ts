import type { VdMessageOrigin } from '@healthy360/api-client/contracts';
import type { BadgeTone, CalloutTone, IconName } from '@healthy360/design-system';
import type { VdSessionState } from '@healthy360/domain-types';

/**
 * How each of the twelve Virtual Dietitian states presents itself, as one table.
 *
 * The contract enumerates twelve states and four of them are blocked outcomes. Screens for the
 * happy path tend to get built and the blocked ones tend to get a toast, which is exactly the defect
 * the reference research warns about (doc 17, RISK-03: "users meet them at their worst moment").
 * Putting tone, icon, test id and reply affordance in a single exhaustive `Record` means a
 * thirteenth state cannot compile until somebody has decided how it looks.
 *
 * Three rules are encoded here rather than left to each panel:
 *
 * 1. **Every state gets its own test id**, `vd-state-<kebab>`, so a test can assert which one is on
 *    screen without matching prose.
 * 2. **Tone never carries the meaning alone.** Each state also has its own icon, and every panel
 *    renders a headline, so the reading survives greyscale.
 * 3. **`safety_escalation` has no reply box and no generation affordance.** That is a property of
 *    the state, not a decision a panel makes, so it is expressed as data.
 */

export function vdStateTestId(state: VdSessionState): string {
    return `vd-state-${state.replace(/_/g, '-')}`;
}

export const VD_STATE_TONE: Readonly<Record<VdSessionState, CalloutTone>> = {
    initial_interview: 'info',
    analysing: 'info',
    missing_information: 'warning',
    suggested_targets: 'info',
    suggested_meal_structure: 'info',
    draft_generated: 'success',
    review_requested: 'info',
    professionally_approved: 'success',
    generation_failed: 'danger',
    restriction_conflict: 'warning',
    no_suitable_meals: 'warning',
    safety_escalation: 'danger',
};

export const VD_STATE_ICON: Readonly<Record<VdSessionState, IconName>> = {
    initial_interview: 'user',
    analysing: 'refresh',
    missing_information: 'warning',
    suggested_targets: 'info',
    suggested_meal_structure: 'calendar',
    draft_generated: 'check',
    review_requested: 'organisation',
    professionally_approved: 'success',
    generation_failed: 'error',
    restriction_conflict: 'warning',
    no_suitable_meals: 'search',
    safety_escalation: 'offline',
};

export const VD_STATE_BADGE_TONE: Readonly<Record<VdSessionState, BadgeTone>> = {
    initial_interview: 'neutral',
    analysing: 'info',
    missing_information: 'warning',
    suggested_targets: 'info',
    suggested_meal_structure: 'info',
    draft_generated: 'success',
    review_requested: 'brand',
    professionally_approved: 'success',
    generation_failed: 'danger',
    restriction_conflict: 'warning',
    no_suitable_meals: 'warning',
    safety_escalation: 'danger',
};

/**
 * States where a free-text reply moves the session on.
 *
 * The store's `sendMessage` advances one step along the scripted progression and, from any state
 * outside it, lands on `suggested_meal_structure`. That is the right answer for the three
 * recoverable blocked states — adjusting a preference genuinely returns you to the meal structure —
 * and the wrong answer everywhere else. Offering a reply box on `professionally_approved` would let
 * a person silently un-approve their own plan by saying "thanks"; offering one on
 * `safety_escalation` would be worse. Both are therefore absent by construction.
 */
export const VD_REPLY_STATES: Readonly<Record<VdSessionState, boolean>> = {
    initial_interview: true,
    analysing: true,
    missing_information: true,
    suggested_targets: true,
    suggested_meal_structure: true,
    draft_generated: false,
    review_requested: false,
    professionally_approved: false,
    generation_failed: false,
    restriction_conflict: true,
    no_suitable_meals: true,
    safety_escalation: false,
};

export function acceptsReply(state: VdSessionState): boolean {
    return VD_REPLY_STATES[state];
}

/** Machine authorship is a property of the message; this only decides how it is labelled. */
export type VdOriginKind = 'ai' | 'human' | 'dietitian' | 'system';

export interface OriginBadgeSpec {
    readonly kind: VdOriginKind;
    readonly tone: BadgeTone;
    readonly icon: IconName;
    readonly labelKey: string;
    readonly testID: string;
}

/**
 * The four origin labels, deliberately distinct on three axes at once — tone, glyph and wording.
 *
 * An AI suggestion that cannot be told apart from a professional's advice is the single most
 * damaging thing this feature could ship (`contracts/virtual-dietitian.ts`), so distinctness is
 * asserted by test rather than left to a reviewer's eye.
 */
export const ORIGIN_BADGES: Readonly<Record<VdOriginKind, OriginBadgeSpec>> = {
    ai: {
        kind: 'ai',
        tone: 'info',
        // The sparkle, which Rule 5 reserves for machine-generated content. It replaces the
        // `prototype` diamond, which meant nothing and was the nearest glyph available before the
        // vocabulary gained one that actually says "a machine wrote this".
        //
        // The tone is untouched. These four must differ on tone, glyph *and* wording at once, and
        // that is asserted by test — moving one axis to match a colour scheme is how the set stops
        // being distinguishable by anything but colour.
        icon: 'sparkle',
        labelKey: 'virtualDietitian:origin.ai',
        testID: 'vd-origin-ai',
    },
    human: {
        kind: 'human',
        tone: 'success',
        icon: 'user',
        labelKey: 'virtualDietitian:origin.human',
        testID: 'vd-origin-human',
    },
    dietitian: {
        kind: 'dietitian',
        tone: 'brand',
        icon: 'check',
        labelKey: 'virtualDietitian:origin.dietitian',
        testID: 'vd-origin-dietitian',
    },
    system: {
        kind: 'system',
        tone: 'neutral',
        icon: 'info',
        labelKey: 'virtualDietitian:origin.system',
        testID: 'vd-origin-system',
    },
};

/** A message's origin kind. `aiGenerated` is the contract's authority, not the origin string. */
export function originKindOf(origin: VdMessageOrigin, aiGenerated: boolean): VdOriginKind {
    if (aiGenerated) return 'ai';
    if (origin === 'dietitian') return 'dietitian';
    if (origin === 'system') return 'system';
    return 'human';
}

/* ── the scripted quick replies ──────────────────────────────────────────────────────────────── */

/**
 * Suggested answers per state, with the structured answers each one records.
 *
 * These are the *person's* words, not the assistant's: the mock's script decides what comes back,
 * and what goes in is whatever a real person would plausibly type. `answers` is what fills the
 * collected panel, because `VdMessage.collected` is a real contract field the store persists — the
 * panel reads the session, never a local copy of what was typed.
 */
export interface VdQuickReply {
    readonly key: string;
    readonly answers?: Readonly<Record<string, string | number | boolean>> | undefined;
}

const NO_REPLIES: readonly VdQuickReply[] = [];

const QUICK_REPLIES: Readonly<Record<VdSessionState, readonly VdQuickReply[]>> = {
    initial_interview: [
        { key: 'profile', answers: { ageYears: 34, heightCentimetres: 165, weightKilograms: 68 } },
        { key: 'activity', answers: { activityLevel: 'moderately_active' } },
        { key: 'goal', answers: { goal: 'lose_weight', pace: 'standard' } },
    ],
    analysing: [
        { key: 'confirmRestrictions', answers: { confirmRestrictions: true } },
        { key: 'addDislike', answers: { dislikedIngredient: 'aubergine' } },
    ],
    missing_information: [
        { key: 'budget', answers: { weeklyBudgetMinorUnits: 45000 } },
        { key: 'deliveryArea', answers: { deliveryArea: 'Business Bay' } },
    ],
    suggested_targets: [
        { key: 'looksRight', answers: { acceptedTargets: true } },
        { key: 'moreProtein', answers: { proteinPreference: 'higher' } },
    ],
    suggested_meal_structure: [
        { key: 'confirmLayout', answers: { mealsPerDay: 3, snacksPerDay: 1 } },
        { key: 'kitchenLunch', answers: { preparationMode: 'mixed' } },
    ],
    draft_generated: NO_REPLIES,
    review_requested: NO_REPLIES,
    professionally_approved: NO_REPLIES,
    generation_failed: NO_REPLIES,
    restriction_conflict: [
        { key: 'relaxSoy', answers: { allowSoy: true } },
        { key: 'allowHome', answers: { preparationMode: 'mixed' } },
    ],
    no_suitable_meals: [
        { key: 'widenArea', answers: { deliveryArea: 'Dubai Marina' } },
        { key: 'allowHome', answers: { preparationMode: 'home_prepared' } },
    ],
    safety_escalation: NO_REPLIES,
};

export function quickRepliesFor(state: VdSessionState): readonly VdQuickReply[] {
    return QUICK_REPLIES[state];
}

/** `virtualDietitian:quickReplies.<state>.<key>` — the sentence the person sends. */
export function quickReplyKey(state: VdSessionState, key: string): string {
    return `virtualDietitian:quickReplies.${state}.${key}`;
}

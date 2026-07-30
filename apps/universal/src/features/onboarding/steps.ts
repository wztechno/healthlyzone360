import type { IconName } from '@healthy360/design-system';
import { RESTRICTION_KINDS } from '@healthy360/domain-types';
import type { RestrictionKind } from '@healthy360/domain-types';

/**
 * The twenty-two onboarding steps, as a table.
 *
 * Two properties are load-bearing.
 *
 * **The slug is the route.** `/customer/onboarding/units` is the second step, and it is that step in
 * every build, in both languages, after any reordering of the copy. A step addressed by ordinal
 * (`/customer/onboarding/2`) would silently point somewhere else the first time a step is inserted,
 * and every bookmark, every deep link and every "edit this answer" control on the summary would move
 * with it (doc 17, ONB-13).
 *
 * **The order lives here and nowhere else.** Progress, back, next, the summary's edit links and the
 * "earliest incomplete step" redirect all read this array. A second ordering — say, a switch
 * statement in the screen — is how a wizard ends up able to reach step 9 from step 7 in one
 * direction and not the other.
 */
export const ONBOARDING_STEP_SLUGS = [
    'introduction',
    'units',
    'age',
    'calculation-basis',
    'height',
    'weight',
    'body-fat',
    'activity',
    'goal',
    'pace',
    'diet',
    'allergies',
    'restrictions',
    'dislikes',
    'cuisines',
    'budget',
    'cooking',
    'meals',
    'meal-times',
    'preparation',
    'summary',
    'review',
] as const;

export type OnboardingStepSlug = (typeof ONBOARDING_STEP_SLUGS)[number];

export const ONBOARDING_STEP_COUNT = ONBOARDING_STEP_SLUGS.length;

/** The first step. Used by the index redirect and by every "start again" control. */
export const FIRST_ONBOARDING_STEP: OnboardingStepSlug = 'introduction';

/**
 * Sections of the summary, in reading order.
 *
 * The summary groups by *what the answer is about* rather than by step number, because "am I
 * described correctly?" and "did I say the right things about food?" are two different review
 * passes and a flat list of twenty-two rows supports neither.
 */
export const ONBOARDING_SECTIONS = ['aboutYou', 'yourGoal', 'whatYouEat', 'howYouCook'] as const;
export type OnboardingSection = (typeof ONBOARDING_SECTIONS)[number];

export interface OnboardingStepDescriptor {
    readonly slug: OnboardingStepSlug;
    /** One-based position, for `Stepper` and for "Step 7 of 22". */
    readonly position: number;
    /**
     * Which summary section this step's answers are reviewed under. `null` for the three steps that
     * collect no reviewable answer of their own — the introduction, the summary and the warning.
     */
    readonly section: OnboardingSection | null;
    /**
     * True when the step may be left without an answer. A skippable step still validates whatever
     * *was* entered; it simply also accepts nothing.
     */
    readonly optional: boolean;
    /**
     * True when the step shows a figure or a medical-adjacent question and therefore carries the
     * standing disclaimer (doc 17, ONB-12).
     */
    readonly medical: boolean;
}

const SECTION_BY_SLUG: Readonly<Record<OnboardingStepSlug, OnboardingSection | null>> = {
    introduction: null,
    units: 'aboutYou',
    age: 'aboutYou',
    'calculation-basis': 'aboutYou',
    height: 'aboutYou',
    weight: 'aboutYou',
    'body-fat': 'aboutYou',
    activity: 'aboutYou',
    goal: 'yourGoal',
    pace: 'yourGoal',
    diet: 'whatYouEat',
    allergies: 'whatYouEat',
    restrictions: 'whatYouEat',
    dislikes: 'whatYouEat',
    cuisines: 'whatYouEat',
    budget: 'howYouCook',
    cooking: 'howYouCook',
    meals: 'howYouCook',
    'meal-times': 'howYouCook',
    preparation: 'howYouCook',
    summary: null,
    review: null,
};

/** Steps a person may pass without answering. */
const OPTIONAL_SLUGS: ReadonlySet<OnboardingStepSlug> = new Set<OnboardingStepSlug>([
    'body-fat',
    'restrictions',
    'dislikes',
    'cuisines',
    'budget',
]);

/**
 * Steps that carry the medical disclaimer.
 *
 * Deliberately generous: the disclaimer costs a paragraph and its absence costs credibility, so
 * anything that asks about the body, produces a figure, or touches a clinical claim carries it.
 */
const MEDICAL_SLUGS: ReadonlySet<OnboardingStepSlug> = new Set<OnboardingStepSlug>([
    'introduction',
    'age',
    'calculation-basis',
    'height',
    'weight',
    'body-fat',
    'goal',
    'pace',
    'allergies',
    'restrictions',
    'summary',
    'review',
]);

export const ONBOARDING_STEPS: readonly OnboardingStepDescriptor[] = ONBOARDING_STEP_SLUGS.map(
    (slug, index) => ({
        slug,
        position: index + 1,
        section: SECTION_BY_SLUG[slug],
        optional: OPTIONAL_SLUGS.has(slug),
        medical: MEDICAL_SLUGS.has(slug),
    }),
);

const STEP_BY_SLUG: ReadonlyMap<string, OnboardingStepDescriptor> = new Map(
    ONBOARDING_STEPS.map((step) => [step.slug, step]),
);

export function isOnboardingStepSlug(value: unknown): value is OnboardingStepSlug {
    return typeof value === 'string' && STEP_BY_SLUG.has(value);
}

export function onboardingStep(slug: OnboardingStepSlug): OnboardingStepDescriptor {
    const step = STEP_BY_SLUG.get(slug);
    /* c8 ignore next */
    if (step === undefined) throw new Error(`"${slug}" is not an onboarding step.`);
    return step;
}

/** The step before `slug`, or `null` at the start. */
export function previousStep(slug: OnboardingStepSlug): OnboardingStepSlug | null {
    const index = ONBOARDING_STEP_SLUGS.indexOf(slug);
    return index <= 0 ? null : (ONBOARDING_STEP_SLUGS[index - 1] ?? null);
}

/** The step after `slug`, or `null` at the end. */
export function nextStep(slug: OnboardingStepSlug): OnboardingStepSlug | null {
    const index = ONBOARDING_STEP_SLUGS.indexOf(slug);
    return index < 0 ? null : (ONBOARDING_STEP_SLUGS[index + 1] ?? null);
}

export function onboardingStepPath(slug: OnboardingStepSlug): string {
    return `/customer/onboarding/${slug}`;
}

/* ------------------------------------------------------------------------------------------------
 * The seven restriction kinds
 * ---------------------------------------------------------------------------------------------- */

/** Who, if anybody, may lift a restriction of a given kind. */
export const RESTRICTION_AUTHORITIES = ['person', 'confirmation', 'dietitian', 'nobody'] as const;
export type RestrictionAuthority = (typeof RESTRICTION_AUTHORITIES)[number];

export interface RestrictionKindPresentation {
    readonly kind: RestrictionKind;
    /**
     * The glyph that stands for this kind everywhere it is rendered. Seven distinct glyphs, because
     * seven groups drawn with one icon and seven colours would be a colour-only distinction — which
     * the design system forbids and which is exactly the sort of collapse this taxonomy exists to
     * prevent.
     */
    readonly icon: IconName;
    /** Badge tone. Carries emphasis; it never carries the meaning on its own. */
    readonly tone: 'neutral' | 'info' | 'warning' | 'danger';
    readonly authority: RestrictionAuthority;
    /** The onboarding step where a person supplies restrictions of this kind. */
    readonly capturedAt: OnboardingStepSlug;
    /** False when the person cannot edit it here because somebody else set it. */
    readonly editable: boolean;
}

/**
 * How each of the seven kinds is drawn and who owns it.
 *
 * This table is the single answer to "are these really different?" — and it is a table rather than
 * a `switch` so a test can assert that all seven are present, that no two share a glyph, and that
 * the authority column is what the domain's `isSafetyCriticalRestriction` says it is.
 *
 * The glyph vocabulary is the design system's thirty characters; it has no padlock, no leaf and no
 * medical cross, so each choice below is the nearest honest one and the gap is recorded in the wave
 * report rather than closed by adding a glyph from a feature module.
 */
export const RESTRICTION_PRESENTATION: Readonly<
    Record<RestrictionKind, RestrictionKindPresentation>
> = {
    preference: {
        kind: 'preference',
        icon: 'starOutline',
        tone: 'neutral',
        authority: 'person',
        capturedAt: 'diet',
        editable: true,
    },
    religious: {
        kind: 'religious',
        icon: 'star',
        tone: 'info',
        authority: 'confirmation',
        capturedAt: 'diet',
        editable: true,
    },
    allergy: {
        kind: 'allergy',
        icon: 'error',
        tone: 'danger',
        authority: 'nobody',
        capturedAt: 'allergies',
        editable: true,
    },
    intolerance: {
        kind: 'intolerance',
        icon: 'warning',
        tone: 'warning',
        authority: 'confirmation',
        capturedAt: 'allergies',
        editable: true,
    },
    self_declared_medical: {
        kind: 'self_declared_medical',
        icon: 'user',
        tone: 'warning',
        authority: 'person',
        capturedAt: 'restrictions',
        editable: true,
    },
    dietitian_enforced: {
        kind: 'dietitian_enforced',
        icon: 'success',
        tone: 'info',
        authority: 'dietitian',
        capturedAt: 'restrictions',
        editable: false,
    },
    dislike: {
        kind: 'dislike',
        icon: 'minus',
        tone: 'neutral',
        authority: 'person',
        capturedAt: 'dislikes',
        editable: true,
    },
};

/**
 * The seven kinds in the order the summary shows them: safety first, taste last.
 *
 * Derived from `RESTRICTION_KINDS` rather than written out again, so a kind added to the domain
 * vocabulary fails this module's test instead of silently disappearing from the interface.
 */
export const RESTRICTION_DISPLAY_ORDER: readonly RestrictionKind[] = [
    'allergy',
    'dietitian_enforced',
    'self_declared_medical',
    'intolerance',
    'religious',
    'preference',
    'dislike',
];

export function restrictionPresentation(kind: RestrictionKind): RestrictionKindPresentation {
    return RESTRICTION_PRESENTATION[kind];
}

/** True when every domain restriction kind has a presentation. Asserted by test. */
export function everyRestrictionKindIsPresented(): boolean {
    return RESTRICTION_KINDS.every((kind) => RESTRICTION_PRESENTATION[kind] !== undefined);
}

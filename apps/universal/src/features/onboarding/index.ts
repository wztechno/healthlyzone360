export { OnboardingIndexScreen, OnboardingScreen } from './onboarding-screen.tsx';
export type { OnboardingScreenProps } from './onboarding-screen.tsx';

export { OnboardingProvider, useOnboarding } from './onboarding-provider.tsx';
export type { OnboardingContextValue, OnboardingProviderProps } from './onboarding-provider.tsx';

export {
    FIRST_ONBOARDING_STEP,
    ONBOARDING_SECTIONS,
    ONBOARDING_STEPS,
    ONBOARDING_STEP_COUNT,
    ONBOARDING_STEP_SLUGS,
    RESTRICTION_DISPLAY_ORDER,
    RESTRICTION_PRESENTATION,
    everyRestrictionKindIsPresented,
    isOnboardingStepSlug,
    nextStep,
    onboardingStep,
    onboardingStepPath,
    previousStep,
    restrictionPresentation,
} from './steps.ts';
export type {
    OnboardingSection,
    OnboardingStepDescriptor,
    OnboardingStepSlug,
    RestrictionAuthority,
    RestrictionKindPresentation,
} from './steps.ts';

export {
    INITIAL_ANSWERS,
    firstIncompleteStep,
    isReadyToCalculate,
    isStepComplete,
    isStepReachable,
    onboardingReducer,
    preferredCuisineValues,
    resizeMealSlots,
    toTargetRequest,
    weeklyBudgetMoney,
} from './state.ts';
export type { OnboardingAction, OnboardingAnswers, OnboardingMealSlot } from './state.ts';

export {
    buildConstraints,
    constraintLabelKey,
    enforcedConstraintsOf,
    groupByRestrictionKind,
    mergeConstraints,
    safetyCriticalKinds,
} from './constraints.ts';
export type { RestrictionGroup } from './constraints.ts';

export { validateStep } from './schemas.ts';
export type { StepErrors } from './schemas.ts';

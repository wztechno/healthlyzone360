import { createContext, useContext, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';

import { INITIAL_ANSWERS, onboardingReducer } from './state.ts';
import type { OnboardingAction, OnboardingAnswers } from './state.ts';

/**
 * The wizard's answers, held above the route.
 *
 * Expo Router renders `[step].tsx` fresh for every slug, so state owned by the step component would
 * be discarded on the way from step 3 to step 4 — and the wizard would collect twenty-two answers
 * and remember one. The provider therefore lives in `app/customer/onboarding/_layout.tsx`, which
 * stays mounted for the whole of the wizard and unmounts when the person leaves it.
 *
 * Leaving the wizard *does* discard the answers, and that is the honest behaviour rather than a
 * limitation dressed up as a decision: there is no proposed endpoint that stores a partial
 * onboarding (see `./state.ts`), so a wizard that claimed to have saved a person's progress would
 * be lying to them. The introduction step says as much before the first question.
 */
export interface OnboardingContextValue {
    readonly answers: OnboardingAnswers;
    readonly dispatch: (action: OnboardingAction) => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export interface OnboardingProviderProps {
    readonly children: ReactNode;
    /** Test and story seam: start from a partly-filled answer set. */
    readonly initialAnswers?: OnboardingAnswers | undefined;
}

export function OnboardingProvider({ children, initialAnswers }: OnboardingProviderProps) {
    const [answers, dispatch] = useReducer(onboardingReducer, initialAnswers ?? INITIAL_ANSWERS);

    const value = useMemo<OnboardingContextValue>(() => ({ answers, dispatch }), [answers]);

    return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
    const value = useContext(OnboardingContext);
    if (value === null) {
        throw new Error('useOnboarding must be used inside an <OnboardingProvider>.');
    }
    return value;
}

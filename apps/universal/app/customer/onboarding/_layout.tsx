import { Slot } from 'expo-router';

import { OnboardingProvider } from '../../../src/features/onboarding/onboarding-provider.tsx';

/**
 * The onboarding wizard's own layout.
 *
 * It exists for exactly one reason: `[step].tsx` is re-rendered from scratch for every slug, so the
 * twenty-two answers have to be held by something that outlives a step change. A layout does; a
 * screen does not.
 *
 * The consumer chrome comes from `app/customer/_layout.tsx` above this, so the wizard keeps the
 * navigation, the offline indicator and the gate rather than becoming a modal island a person can
 * get stuck in.
 */
export default function OnboardingLayout() {
    return (
        <OnboardingProvider>
            <Slot />
        </OnboardingProvider>
    );
}

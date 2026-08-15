import { Redirect, useLocalSearchParams } from 'expo-router';

import {
    FIRST_ONBOARDING_STEP,
    isOnboardingStepSlug,
    onboardingStepPath,
} from '../../../src/features/onboarding/steps.ts';
import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/onboarding/{step}` — one step of the wizard, addressed by its slug.
 *
 * The only thing decided here is whether the slug is a step at all. An unknown one — a typo, a
 * stale bookmark, a slug that existed in an earlier build — resolves to the first step rather than
 * to "not found": the person is trying to set up their plan, and a 404 is a worse answer than the
 * beginning. Everything else, including whether they are allowed to *be* on that step yet, belongs
 * to the screen, which is the thing that can see the answers.
 *
 * `steps.ts` stays a static import while the screen is lazy: the slug check happens before anything
 * is rendered, so making it wait on a chunk would turn a bad bookmark into a spinner.
 *
 * No `generateStaticParams`: pre-rendering twenty-two pages would bake the step list into the
 * export, and the static server already falls back to the application shell for extension-less
 * paths, so a deep link resolves client-side.
 */
const OnboardingScreen = lazyScreen(
    'onboarding-loading',
    async () =>
        (await import('../../../src/features/onboarding/onboarding-screen.tsx')).OnboardingScreen,
);

export default function OnboardingStepRoute() {
    const { step } = useLocalSearchParams<{ step?: string }>();

    if (!isOnboardingStepSlug(step)) {
        return <Redirect href={onboardingStepPath(FIRST_ONBOARDING_STEP) as never} />;
    }

    return <OnboardingScreen slug={step} />;
}

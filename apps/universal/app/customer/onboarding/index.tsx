import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/onboarding` — resumes wherever the person left off.
 *
 * A redirect rather than a landing page: the wizard's first step is already an introduction, and a
 * second screen in front of it would be a page whose only content is a button.
 */
const OnboardingIndexScreen = lazyScreen(
    'onboarding-index-loading',
    async () =>
        (await import('../../../src/features/onboarding/onboarding-screen.tsx'))
            .OnboardingIndexScreen,
);

export default function OnboardingIndex() {
    return <OnboardingIndexScreen />;
}

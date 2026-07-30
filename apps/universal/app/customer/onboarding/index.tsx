import { OnboardingIndexScreen } from '../../../src/features/onboarding/onboarding-screen.tsx';

/**
 * `/customer/onboarding` — resumes wherever the person left off.
 *
 * A redirect rather than a landing page: the wizard's first step is already an introduction, and a
 * second screen in front of it would be a page whose only content is a button.
 */
export default function OnboardingIndex() {
    return <OnboardingIndexScreen />;
}

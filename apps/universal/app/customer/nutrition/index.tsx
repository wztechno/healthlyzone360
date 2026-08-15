import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/nutrition` — the person's current targets, and how they were arrived at.
 *
 * Reachable directly: onboarding sends people here on completion, and it is also where somebody
 * returns to check a figure without going near the wizard again. The empty state — no target yet —
 * is a real state with a route out of it rather than an error.
 */
const NutritionTargetScreen = lazyScreen(
    'nutrition-target-loading',
    async () =>
        (await import('../../../src/features/nutrition/nutrition-target-screen.tsx'))
            .NutritionTargetScreen,
);

export default function CustomerNutrition() {
    return <NutritionTargetScreen />;
}

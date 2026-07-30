import { NutritionTargetScreen } from '../../../src/features/nutrition/nutrition-target-screen.tsx';

/**
 * `/customer/nutrition` — the person's current targets, and how they were arrived at.
 *
 * Reachable directly: onboarding sends people here on completion, and it is also where somebody
 * returns to check a figure without going near the wizard again. The empty state — no target yet —
 * is a real state with a route out of it rather than an error.
 */
export default function CustomerNutrition() {
    return <NutritionTargetScreen />;
}

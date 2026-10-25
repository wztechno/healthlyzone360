import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/plans/{plan}` — the plan editor.
 *
 * `new` opens the create form, exactly as the ingredient, recipe, product and meal editors do:
 * `KitchenAdminRepository` publishes `createPlan`, so the route parameter genuinely has a
 * non-identifier value. Anything else is validated in the screen, so a hand-typed link produces the
 * designed not-found state rather than a repository failure.
 */
const PlanEditScreen = lazyScreen(
    'kitchen-plan-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).PlanEditScreen,
);

export default function KitchenPlanEditor() {
    // `?returnTo=`: the page that sent the reader here — the review queue, on this record.
    const { plan, returnTo } = useLocalSearchParams<{ plan?: string; returnTo?: string }>();
    return <PlanEditScreen plan={plan} returnTo={returnTo} />;
}

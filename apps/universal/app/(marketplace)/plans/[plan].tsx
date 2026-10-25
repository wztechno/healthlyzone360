import { useLocalSearchParams } from 'expo-router';

import { PlanDetailScreen } from '../../../src/features/catalogue/screens/plan-detail-screen.tsx';

/**
 * `/plans/{plan}` — one subscription plan. `?returnTo=` is the kitchen record a staff member opened
 * it from ("See it on the menu"), and the way back to it.
 */
export default function PlanDetail() {
    const { plan, returnTo } = useLocalSearchParams<{ plan?: string; returnTo?: string }>();
    return <PlanDetailScreen planId={plan} returnTo={returnTo} />;
}

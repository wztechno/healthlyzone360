import { useLocalSearchParams } from 'expo-router';

import { PlanDetailScreen } from '../../../src/features/catalogue/screens/plan-detail-screen.tsx';

/** `/plans/{plan}` — one subscription plan. */
export default function PlanDetail() {
    const { plan } = useLocalSearchParams<{ plan?: string }>();
    return <PlanDetailScreen planId={plan} />;
}

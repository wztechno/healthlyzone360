import { useLocalSearchParams } from 'expo-router';

import { ClientPlanScreen } from '../../../../../src/features/professional/screens/client-plan-screen.tsx';

/**
 * `/dietitian/clients/{client}/{plan}/{week}` — a client's week, as the professional sees it.
 *
 * All three parts are in the path because `getClientPlan` needs all three and none of them has a
 * defensible default: guessing the week from the clock would show a different week depending on when
 * the link was opened. Each is validated in the screen.
 */
export default function DietitianClientPlan() {
    const { clientId, planId, week } = useLocalSearchParams<{
        clientId?: string;
        planId?: string;
        week?: string;
    }>();
    return <ClientPlanScreen clientId={clientId} planId={planId} weekStart={week} />;
}

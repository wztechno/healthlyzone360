import { useLocalSearchParams } from 'expo-router';

import { VdSessionScreen } from '../../../src/features/virtual-dietitian/screens/vd-session-screen.tsx';

/**
 * `/customer/virtual-dietitian/{session}` — one session, in whichever of the twelve states it is in.
 *
 * The parameter is read here and validated in the screen, so a malformed identifier from a hand-typed
 * link produces the designed not-found state rather than a repository failure.
 */
export default function VirtualDietitianSessionRoute() {
    const { session } = useLocalSearchParams<{ session?: string }>();
    return <VdSessionScreen sessionId={session} />;
}

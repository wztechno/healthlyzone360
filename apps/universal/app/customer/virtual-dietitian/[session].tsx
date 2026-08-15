import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/virtual-dietitian/{session}` — one session, in whichever of the twelve states it is in.
 *
 * The parameter is read here and validated in the screen, so a malformed identifier from a hand-typed
 * link produces the designed not-found state rather than a repository failure.
 */
const VdSessionScreen = lazyScreen(
    'vd-session-loading',
    async () =>
        (await import('../../../src/features/virtual-dietitian/screens/index.ts')).VdSessionScreen,
);

export default function VirtualDietitianSessionRoute() {
    const { session } = useLocalSearchParams<{ session?: string }>();
    return <VdSessionScreen sessionId={session} />;
}

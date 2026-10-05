import { createMemoryTokenStore } from '@healthy360/api-client';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { useLogoutMutation } from '../data/hooks.ts';
import { AppProviders } from '../providers.tsx';
import { testMeResponse } from '../testing/session-fixtures.ts';
import { createStubRepositories } from '../testing/stub-repositories.ts';
import {
    STUB_SESSION_TOKEN,
    TEST_METRICS,
    createTestQueryClient,
} from '../testing/stub-screen.tsx';
import { useSession } from './session-provider.tsx';

/** What the header reads: the phase, and the name on the account button. */
function Probe() {
    const { phase, me } = useSession();
    const logout = useLogoutMutation();
    return (
        <>
            <Text testID="phase">{phase}</Text>
            <Text testID="name">{me?.profile.displayName ?? '—'}</Text>
            <Pressable
                testID="sign-out"
                onPress={() => {
                    logout.mutate();
                }}
            />
        </>
    );
}

describe('SessionProvider', () => {
    it('signs out at once: no token means no session, whatever the cache still holds', async () => {
        const tokenStore = createMemoryTokenStore(STUB_SESSION_TOKEN);
        const me = testMeResponse();
        const repositories = createStubRepositories(
            {
                session: { me: async () => me },
                // The real bearer logout is local: it forgets the token and resolves.
                auth: {
                    logout: async () => {
                        tokenStore.clear();
                    },
                },
            },
            { latencyMs: 0 },
        );

        await render(
            <AppProviders
                initialMetrics={TEST_METRICS}
                repositories={repositories}
                tokenStore={tokenStore}
                queryClient={createTestQueryClient()}
                initialOnline
            >
                <Probe />
            </AppProviders>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('name')).toHaveTextContent(me.profile.displayName);
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('sign-out'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('phase')).toHaveTextContent('anonymous');
        });
        expect(screen.getByTestId('name')).toHaveTextContent('—');
        expect(tokenStore.get()).toBeNull();
    });
});

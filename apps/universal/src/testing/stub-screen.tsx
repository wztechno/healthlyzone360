import { createMemoryTokenStore } from '@healthy360/api-client';
import type { MeResponse, Repositories } from '@healthy360/api-client';
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { RenderResult } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AppProviders } from '../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from './render-screen.tsx';
import { createStubRepositories } from './stub-repositories.ts';
import type { RepositoryOverrides } from './stub-repositories.ts';

/**
 * Screen-test harness over stub repositories — the successor to `renderScreen`.
 *
 * Where the old harness signed into a fixture world, this one *declares* everything: the session
 * the screen should see (a `MeResponse` from `session-fixtures.ts`) and the repository answers it
 * may rely on (per-method overrides). Anything the screen calls that the test did not declare
 * rejects loudly with `StubNotConfiguredError` naming the surface — a hole in a test fails on
 * first render instead of rendering an empty state over it.
 *
 * Latency defaults to 25 ms for the same reason `renderScreen`'s did: at 0 the stub resolves on a
 * microtask and whether a loading skeleton is still mounted after `await render(...)` becomes a
 * race. 25 ms keeps the pending frame deterministically observable.
 */

export interface StubScreenOptions {
    /** Per-repository, per-method answers. Everything else rejects with StubNotConfiguredError. */
    readonly repositories?: RepositoryOverrides | undefined;
    /**
     * Sign this session in before rendering: a token is primed into the store and `session.me`
     * answers with exactly this payload (unless the overrides provide their own `session.me`).
     * Omit for an anonymous screen.
     */
    readonly session?: MeResponse | undefined;
    readonly initialOnline?: boolean | undefined;
    /** Stubbed-method round-trip in ms. Unstubbed methods always reject immediately. */
    readonly latencyMs?: number | undefined;
}

export interface StubScreenHarness {
    readonly view: RenderResult;
    /** Every method is a jest.fn — assert calls directly, e.g. `repositories.commerce.getCart`. */
    readonly repositories: Repositories;
    readonly queryClient: QueryClient;
}

export const STUB_SESSION_TOKEN = 'stub-session-token';

export async function renderStubScreen(
    node: ReactNode,
    options: StubScreenOptions = {},
): Promise<StubScreenHarness> {
    const tokenStore = createMemoryTokenStore(
        options.session === undefined ? null : STUB_SESSION_TOKEN,
    );

    const session = options.session;
    const overrides: RepositoryOverrides =
        session === undefined || options.repositories?.session?.me !== undefined
            ? (options.repositories ?? {})
            : {
                  ...options.repositories,
                  session: { ...options.repositories?.session, me: async () => session },
              };

    const repositories = createStubRepositories(overrides, {
        latencyMs: options.latencyMs ?? 25,
    });

    const queryClient = createTestQueryClient();

    const view = await render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={tokenStore}
            queryClient={queryClient}
            initialOnline={options.initialOnline ?? true}
        >
            {node}
        </AppProviders>,
    );

    return { view, repositories, queryClient };
}

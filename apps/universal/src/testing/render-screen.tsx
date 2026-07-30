import { createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories, MockScenarioName } from '@healthy360/api-client/mock';
import { createMemoryTokenStore } from '@healthy360/api-client';
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { RenderResult } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AppProviders } from '../providers.tsx';

/**
 * Screen-test harness.
 *
 * Screens are rendered against **real mock repositories**, not hand-stubbed hooks. That is the
 * whole value of the repository boundary: the same object the application uses in development is
 * the one under test, so a screen that mishandles a real `ApiFailure` fails here rather than in
 * Playwright.
 *
 * Latency is zero and retries are off, because a test should assert behaviour rather than wait for
 * a simulated network.
 */
export const TEST_METRICS = {
    frame: { x: 0, y: 0, width: 1280, height: 900 },
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export interface ScreenHarness {
    readonly view: RenderResult;
    readonly repositories: MockRepositories;
    readonly queryClient: QueryClient;
}

export interface RenderScreenOptions {
    readonly scenario?: MockScenarioName | undefined;
    /** Sign this account in before rendering, so the screen starts from a live session. */
    readonly signInAs?: string | undefined;
    readonly initialOnline?: boolean | undefined;
    /** Mock round-trip in ms. Defaults to 25 so loading frames are deterministically observable. */
    readonly latencyMs?: number | undefined;
}

export function createTestQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0, staleTime: 0 },
            mutations: { retry: false },
        },
    });
}

export async function renderScreen(
    node: ReactNode,
    options: RenderScreenOptions = {},
): Promise<ScreenHarness> {
    const tokenStore = createMemoryTokenStore();
    const repositories = createMockRepositories({
        scenario: options.scenario ?? 'multi-org-dietitian',
        // A small but real latency: at 0 the mock resolves on a microtask, so whether a loading
        // skeleton is still mounted after `await render(...)` is a race that flakes under
        // concurrent CPU load (it did). 25 ms keeps the pending frame deterministically
        // observable while success-path assertions already wait via findBy/waitFor.
        latencyMs: options.latencyMs ?? 25,
        tokenStore,
    });

    if (options.signInAs !== undefined) {
        await repositories.auth.login({ email: options.signInAs, password: 'password' });
    }

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

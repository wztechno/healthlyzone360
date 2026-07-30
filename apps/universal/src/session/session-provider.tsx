import type { ApiFailure, MeResponse } from '@healthy360/api-client';
import type { AccessState } from '@healthy360/permissions';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import { appConfig } from '../config.ts';
import { toFailure, useMeQuery, useSessionToken } from '../data/hooks.ts';
import { useRepositoryContext } from '../data/repository-provider.tsx';
import { buildAccessState, resolveSessionPhase } from './machine.ts';
import type { SessionPhase } from './machine.ts';

export interface SessionContextValue {
    readonly phase: SessionPhase;
    readonly me: MeResponse | null;
    readonly failure: ApiFailure | null;
    readonly accessState: AccessState;
    /**
     * True while `me()` is (re)fetching. Context-dependent redirects must hold (render a splash)
     * rather than fire while this is true: after a context change, the new route can mount one
     * frame before the session context re-renders with the fresh cache, and redirecting off that
     * stale frame bounces the user straight back to the picker they just left.
     */
    readonly isRefreshing: boolean;
    readonly refetch: () => void;
    /** Construction-level failure from the repository factory (mock-in-production, missing URL). */
    readonly repositoryError: Error | null;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
    readonly children: ReactNode;
}

/**
 * The single source of "who is signed in and what may they do".
 *
 * It is deliberately thin: `me()` is an ordinary TanStack query, and everything else is the pure
 * projection in `machine.ts`. Nothing here holds derived state of its own, so there is no second
 * copy of the session to fall out of date — the query cache is the only store.
 */
export function SessionProvider({ children }: SessionProviderProps) {
    const { repositories, error: repositoryError } = useRepositoryContext();
    const meQuery = useMeQuery();
    const hasToken = useSessionToken() !== null;

    const me = meQuery.data ?? null;
    const failure = toFailure(meQuery.error);

    const phase = resolveSessionPhase({
        repositoriesReady: repositories !== null,
        hasToken,
        me,
        failure,
    });

    const accessState = useMemo(
        () => buildAccessState({ mode: appConfig.appMode, phase, me }),
        [phase, me],
    );

    const value = useMemo<SessionContextValue>(
        () => ({
            phase,
            me,
            failure,
            accessState,
            isRefreshing: meQuery.isFetching,
            refetch: () => {
                void meQuery.refetch();
            },
            repositoryError,
        }),
        [phase, me, failure, accessState, meQuery, repositoryError],
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
    const value = useContext(SessionContext);
    if (value === null) {
        throw new Error('useSession must be used inside a <SessionProvider>.');
    }
    return value;
}

export function useAccessState(): AccessState {
    return useSession().accessState;
}

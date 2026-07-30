import type { ConnectivityState } from '@healthy360/design-system';
import { onlineManager } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { isNetworkOnline, subscribeToNetwork } from './network.ts';

/** How long the "connection restored" confirmation stays up before it gets out of the way. */
export const RESTORED_NOTICE_MS = 4000;

export interface OnlineStatusValue {
    readonly online: boolean;
    readonly state: ConnectivityState;
}

const OnlineStatusContext = createContext<OnlineStatusValue>({ online: true, state: 'online' });

export interface OnlineStatusProviderProps {
    readonly children: ReactNode;
    /** Test seam: pin the state instead of listening to the platform. */
    readonly initialOnline?: boolean | undefined;
    readonly restoredNoticeMs?: number | undefined;
}

/**
 * Advances the connectivity state machine.
 *
 * ```
 * online ──offline──► offline ──online──► restored ──(timeout)──► online
 * ```
 *
 * Written as a pure reducer over the previous value so the whole transition happens inside one
 * `setState` updater called from the network listener. No effect ever observes `online` and writes
 * a derived state in response — that would be a cascading render, and it is what
 * `react-hooks/set-state-in-effect` exists to catch.
 */
export function nextConnectivity(previous: OnlineStatusValue, online: boolean): OnlineStatusValue {
    if (!online) return { online: false, state: 'offline' };
    if (previous.online) return previous;
    // Coming back is *confirmed* rather than silent: a banner that simply vanishes leaves the user
    // unsure whether anything actually changed.
    return { online: true, state: 'restored' };
}

/**
 * Bridges platform connectivity into both TanStack Query and the UI.
 *
 * `onlineManager` is told first, because that is what makes paused queries resume and
 * `refetchOnReconnect` fire; the banner is a consequence, not the point.
 */
export function OnlineStatusProvider({
    children,
    initialOnline,
    restoredNoticeMs = RESTORED_NOTICE_MS,
}: OnlineStatusProviderProps) {
    const [value, setValue] = useState<OnlineStatusValue>(() => {
        const online = initialOnline ?? isNetworkOnline();
        return { online, state: online ? 'online' : 'offline' };
    });

    const handleNetworkChange = useCallback((online: boolean) => {
        setValue((previous) => nextConnectivity(previous, online));
    }, []);

    // Pushing state *out* to an external system is exactly what an effect is for.
    useEffect(() => {
        onlineManager.setOnline(value.online);
    }, [value.online]);

    useEffect(() => {
        if (initialOnline !== undefined) return;
        return subscribeToNetwork(handleNetworkChange);
    }, [handleNetworkChange, initialOnline]);

    // The `restored` confirmation retires itself on a timer; the write happens in the timeout
    // callback, not in the effect body.
    useEffect(() => {
        if (value.state !== 'restored') return;
        const timer = setTimeout(() => {
            setValue((previous) =>
                previous.state === 'restored'
                    ? { online: previous.online, state: 'online' }
                    : previous,
            );
        }, restoredNoticeMs);
        return () => {
            clearTimeout(timer);
        };
    }, [value.state, restoredNoticeMs]);

    const exposed = useMemo<OnlineStatusValue>(
        () => ({ online: value.online, state: value.state }),
        [value.online, value.state],
    );

    return <OnlineStatusContext.Provider value={exposed}>{children}</OnlineStatusContext.Provider>;
}

export function useOnlineStatus(): OnlineStatusValue {
    return useContext(OnlineStatusContext);
}

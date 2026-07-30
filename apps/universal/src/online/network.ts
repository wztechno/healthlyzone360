/**
 * Web network detection.
 *
 * `navigator.onLine` is famously optimistic — it reports "online" for a machine attached to a
 * network that cannot reach anything — but it is reliable in the direction that matters: when it
 * says *offline*, the browser really has no interface. That is the signal the banner needs.
 * Confirming reachability is TanStack Query's job, through the failures it already sees.
 *
 * Metro resolves `network.native.ts` on iOS and Android.
 */
export type NetworkListener = (online: boolean) => void;

interface NavigatorLike {
    readonly onLine?: boolean;
}

function readNavigator(): NavigatorLike | null {
    if (typeof globalThis === 'undefined') return null;
    return (globalThis as { navigator?: NavigatorLike }).navigator ?? null;
}

export function isNetworkOnline(): boolean {
    const navigatorLike = readNavigator();
    // Absent API (server render, Node test) is treated as online: a false offline banner on every
    // pre-rendered page would be worse than a missed one.
    return navigatorLike?.onLine ?? true;
}

export function subscribeToNetwork(listener: NetworkListener): () => void {
    const target = globalThis as unknown as {
        addEventListener?: (type: string, handler: () => void) => void;
        removeEventListener?: (type: string, handler: () => void) => void;
    };

    if (typeof target.addEventListener !== 'function') return () => undefined;

    const handleOnline = () => {
        listener(true);
    };
    const handleOffline = () => {
        listener(false);
    };

    target.addEventListener('online', handleOnline);
    target.addEventListener('offline', handleOffline);

    return () => {
        target.removeEventListener?.('online', handleOnline);
        target.removeEventListener?.('offline', handleOffline);
    };
}

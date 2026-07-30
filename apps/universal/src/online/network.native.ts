import NetInfo from '@react-native-community/netinfo';

import type { NetworkListener } from './network.ts';

/**
 * Native network detection.
 *
 * `isInternetReachable` is tri-state: `null` means NetInfo has not finished probing. A `null` is
 * treated as **online**, because showing an offline banner during the first second of every cold
 * start would train users to ignore it.
 */
let lastKnown = true;

NetInfo.addEventListener((state) => {
    lastKnown = state.isConnected !== false && state.isInternetReachable !== false;
});

export function isNetworkOnline(): boolean {
    return lastKnown;
}

export function subscribeToNetwork(listener: NetworkListener): () => void {
    return NetInfo.addEventListener((state) => {
        const online = state.isConnected !== false && state.isInternetReachable !== false;
        lastKnown = online;
        listener(online);
    });
}

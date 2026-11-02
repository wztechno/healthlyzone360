import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Keeps a wall screen awake while `active`, and lets go on unmount.
 *
 * A browser releases the lock itself whenever the tab is hidden, so it is asked for again each time
 * the tab returns. Quiet everywhere it cannot work: native has no `navigator.wakeLock` and needs no
 * package for a web surface, and a refused request (low battery, say) leaves a screen that may dim.
 */
export function useWakeLock(active: boolean): void {
    useEffect(() => {
        if (!active || Platform.OS !== 'web' || !('wakeLock' in navigator)) return;

        let lock: WakeLockSentinel | null = null;
        let released = false;

        function request() {
            navigator.wakeLock
                .request('screen')
                .then((granted) => {
                    // Unmounted while the request was out.
                    if (released) void granted.release();
                    else lock = granted;
                })
                .catch(() => undefined);
        }

        function onVisibilityChange() {
            if (document.visibilityState === 'visible') request();
        }

        request();
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            released = true;
            document.removeEventListener('visibilitychange', onVisibilityChange);
            void lock?.release();
        };
    }, [active]);
}

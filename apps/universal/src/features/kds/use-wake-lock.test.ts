import { renderHook, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { useWakeLock } from './use-wake-lock.ts';

/** A screen wake lock the test can watch, on a navigator and document that do not exist here. */
function pretendABrowser() {
    const release = jest.fn(async () => undefined);
    const request = jest.fn(async () => ({ release }));
    const listeners = new Set<() => void>();

    jest.replaceProperty(Platform, 'OS', 'web');
    Object.defineProperty(globalThis, 'navigator', {
        value: { wakeLock: { request } },
        configurable: true,
    });
    Object.defineProperty(globalThis, 'document', {
        value: {
            visibilityState: 'visible',
            addEventListener: (_: string, listener: () => void) => listeners.add(listener),
            removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
        },
        configurable: true,
    });

    return { request, release, listeners };
}

describe('useWakeLock', () => {
    const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    afterEach(() => {
        jest.restoreAllMocks();
        if (navigatorBefore === undefined) Reflect.deleteProperty(globalThis, 'navigator');
        else Object.defineProperty(globalThis, 'navigator', navigatorBefore);
        Reflect.deleteProperty(globalThis, 'document');
    });

    it('does nothing off the web', async () => {
        const { request } = pretendABrowser();
        jest.replaceProperty(Platform, 'OS', 'ios');

        await renderHook(() => {
            useWakeLock(true);
        });

        expect(request).not.toHaveBeenCalled();
    });

    it('asks for the lock, asks again when the tab returns, and lets go on unmount', async () => {
        const { request, release, listeners } = pretendABrowser();

        const { unmount } = await renderHook(() => {
            useWakeLock(true);
        });
        expect(request).toHaveBeenCalledTimes(1);

        for (const listener of listeners) listener();
        expect(request).toHaveBeenCalledTimes(2);

        await unmount();

        await waitFor(() => {
            expect(release).toHaveBeenCalled();
        });
        expect(listeners.size).toBe(0);
    });

    it('asks for nothing while inactive', async () => {
        const { request } = pretendABrowser();

        await renderHook(() => {
            useWakeLock(false);
        });

        expect(request).not.toHaveBeenCalled();
    });
});

import { act, renderHook } from '@testing-library/react-native';

import { guardNavigation, useUnsavedGuard, useUnsavedGuardFor } from './use-unsaved-guard.ts';

/**
 * The sidebar, the page search and the crumbs navigate through `guardNavigation`, which asks the
 * editor on screen first — one that keeps its work as a draft offers to keep it.
 */
describe('guardNavigation', () => {
    it('goes straight there when nothing is unsaved', async () => {
        await renderHook(() => useUnsavedGuard({ message: 'Unsaved' }));
        const navigate = jest.fn();
        guardNavigation(navigate);
        expect(navigate).toHaveBeenCalledTimes(1);
    });

    it('asks an editor that would lose its work, and goes once the reader discards', async () => {
        const { result } = await renderHook(() => useUnsavedGuard({ message: 'Unsaved' }));
        await act(async () => {
            result.current.markDirty();
        });

        const navigate = jest.fn();
        await act(async () => {
            guardNavigation(navigate);
        });
        expect(navigate).not.toHaveBeenCalled();
        expect(result.current.isPrompting).toBe(true);

        await act(async () => {
            result.current.confirmDiscard();
        });
        expect(navigate).toHaveBeenCalledTimes(1);
    });

    it('asks an editor that keeps a draft too, and offers to keep it', async () => {
        let keeps = true;
        const onKeep = jest.fn();
        const onDiscard = jest.fn();
        const { result } = await renderHook(() =>
            useUnsavedGuard({ message: 'Unsaved', keepsDraft: () => keeps, onKeep, onDiscard }),
        );
        await act(async () => {
            result.current.markDirty();
        });

        // Leaving silently looked like losing the work (2026-10-29): it asks, offering Keep.
        const navigate = jest.fn();
        await act(async () => {
            guardNavigation(navigate);
        });
        expect(navigate).not.toHaveBeenCalled();
        expect(result.current.isPrompting).toBe(true);
        expect(result.current.canKeep).toBe(true);

        await act(async () => {
            result.current.confirmKeep();
        });
        expect(onKeep).toHaveBeenCalledTimes(1);
        expect(onDiscard).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(result.current.isPrompting).toBe(false);

        // Read when it asks: a photo nobody can draft takes Keep away.
        keeps = false;
        await act(async () => {
            guardNavigation(navigate);
        });
        expect(result.current.canKeep).toBe(false);
        await act(async () => {
            result.current.confirmDiscard();
        });
        expect(onDiscard).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledTimes(2);
    });

    it('forgets an editor once it is gone', async () => {
        const { result, unmount } = await renderHook(() => useUnsavedGuard({ message: 'Unsaved' }));
        await act(async () => {
            result.current.markDirty();
        });
        await unmount();

        const navigate = jest.fn();
        guardNavigation(navigate);
        expect(navigate).toHaveBeenCalledTimes(1);
    });
});

describe('useUnsavedGuardFor', () => {
    it('follows the value it is given', async () => {
        const { result, rerender } = await renderHook(
            ({ dirty }: { dirty: boolean }) => useUnsavedGuardFor(dirty, { message: 'Unsaved' }),
            { initialProps: { dirty: false } },
        );
        expect(result.current.isDirty).toBe(false);
        await rerender({ dirty: true });
        expect(result.current.isDirty).toBe(true);
        await rerender({ dirty: false });
        expect(result.current.isDirty).toBe(false);
    });
});

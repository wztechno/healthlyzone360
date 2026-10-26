import { act, renderHook } from '@testing-library/react-native';

import { guardNavigation, useUnsavedGuard } from './use-unsaved-guard.ts';

/**
 * The sidebar, the page search and the crumbs navigate through `guardNavigation`, which asks the
 * editor on screen first. An editor that keeps its work as a draft lets the reader go.
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

    it('lets the reader go from an editor that keeps a draft', async () => {
        let keeps = true;
        const { result } = await renderHook(() =>
            useUnsavedGuard({ message: 'Unsaved', keepsDraft: () => keeps }),
        );
        await act(async () => {
            result.current.markDirty();
        });

        const navigate = jest.fn();
        guardNavigation(navigate);
        expect(navigate).toHaveBeenCalledTimes(1);

        // Read when the reader navigates: a photo nobody can draft makes it ask again.
        keeps = false;
        await act(async () => {
            guardNavigation(navigate);
        });
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(result.current.isPrompting).toBe(true);
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

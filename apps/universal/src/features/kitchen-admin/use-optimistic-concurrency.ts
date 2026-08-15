import { asApiFailure } from '@healthy360/api-client/contracts';
import type { ApiFailure } from '@healthy360/api-client/contracts';
import { useCallback, useState } from 'react';

/**
 * The reader's half of optimistic locking (plan §4.13).
 *
 * Every management write carries the `lockVersion` it was based on, and the server refuses a stale
 * one with `resource.conflict` carrying `currentLockVersion`. That refusal is the one failure in
 * this workspace that must **not** be rendered as an error state: the person's work is still on
 * screen and still valid, and only they can decide whether to keep it or take the other version.
 *
 * So this hook turns that single failure code into a two-answer question and leaves every other
 * failure alone for the caller to render normally.
 *
 * ## Why the dialog cannot be dismissed
 *
 * A conflict has exactly two resolutions and neither is "carry on as though nothing happened".
 * Closing the dialog would leave an editor holding a version the server has already rejected, whose
 * next save would fail identically — the classic dialog that teaches people to press Escape. So the
 * caller renders it with no backdrop dismissal and no close route other than the two buttons.
 *
 * ## `currentLockVersion` is optional, and that is load-bearing
 *
 * `resource.conflict` also covers conflicts with no version at all (a duplicate reference, a second
 * publish of the same row). When the server does not say how far behind the caller is, the reload
 * path still works — it refetches — but nothing here invents a number, because an editor that
 * rebased onto a guessed version would send the next write against a lock the server never issued.
 */

export interface ConcurrencyConflict {
    readonly failure: ApiFailure;
    /** `null` when the server did not report one. */
    readonly currentLockVersion: number | null;
}

export interface OptimisticConcurrency {
    /** The open conflict, or `null` when there is none. */
    readonly conflict: ConcurrencyConflict | null;
    /**
     * Classifies a rejection.
     *
     * Returns `true` when it was an optimistic-locking conflict and the dialog is now open, and
     * `false` for everything else — which the caller then renders as it would any other failure.
     */
    readonly capture: (error: unknown) => boolean;
    /** Takes the server's version: the caller refetches and rebases. */
    readonly reload: () => void;
    /** Keeps the local edits and closes the question, leaving the record unsaved. */
    readonly keepEditing: () => void;
}

export interface OptimisticConcurrencyOptions {
    /**
     * Refetches the record and rebases the editor onto whatever came back.
     *
     * Called by {@link OptimisticConcurrency.reload}. Losing the local edits is the *point* of that
     * button, so the caller does not need to preserve them.
     */
    readonly onReload: () => void;
}

export function useOptimisticConcurrency({
    onReload,
}: OptimisticConcurrencyOptions): OptimisticConcurrency {
    const [conflict, setConflict] = useState<ConcurrencyConflict | null>(null);

    const capture = useCallback((error: unknown): boolean => {
        const failure = asApiFailure(error);
        if (failure === null || failure.code !== 'resource.conflict') return false;

        setConflict({
            failure,
            currentLockVersion: failure.currentLockVersion ?? null,
        });
        return true;
    }, []);

    const reload = useCallback(() => {
        setConflict(null);
        onReload();
    }, [onReload]);

    const keepEditing = useCallback(() => {
        setConflict(null);
    }, []);

    return { conflict, capture, reload, keepEditing };
}

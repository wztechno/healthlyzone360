import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Dirty tracking, plus the two ways a person leaves an editor without saving.
 *
 * ## Why this is a hook rather than a `<Prompt>` component
 *
 * The two exits are structurally different and neither can be expressed as rendered output. Closing
 * the tab is a synchronous browser event that must be answered *before* React hears about it, and
 * navigating away is an intent the application raises itself. So the hook owns the flag and exposes
 * an `intercept` the screen calls in place of `router.push` — a component would have to guess which
 * navigations belonged to it.
 *
 * ## The browser prompt is deliberately not customised
 *
 * Every current browser ignores the string handed to `beforeunload` and shows its own wording; the
 * copy exists anyway because native and the in-application dialog use it, and a hook that shipped
 * an untranslated English sentence for those would be worse than one that shipped a translated one
 * the browser happens to override.
 */

export interface UnsavedGuard {
    readonly isDirty: boolean;
    /** Marks the editor changed. Idempotent — safe to call on every keystroke. */
    readonly markDirty: () => void;
    /** Marks it clean again, after a successful save or a discard. */
    readonly markClean: () => void;
    /**
     * Runs `navigate` when there is nothing to lose, or opens the confirmation when there is.
     *
     * Returns `true` when it navigated, so a caller can tell "gone" from "asked".
     */
    readonly intercept: (navigate: () => void) => boolean;
    /** True while the confirmation is open. */
    readonly isPrompting: boolean;
    /** Discards the changes and runs whatever navigation was intercepted. */
    readonly confirmDiscard: () => void;
    /** Closes the confirmation and stays put. */
    readonly cancelDiscard: () => void;
}

export interface UnsavedGuardOptions {
    /** Copy shown by platforms that honour a custom message. Browsers substitute their own. */
    readonly message: string;
    /** Set `false` to disable the guard entirely — a read-only screen, a closed editor. */
    readonly enabled?: boolean | undefined;
}

export function useUnsavedGuard({ message, enabled = true }: UnsavedGuardOptions): UnsavedGuard {
    const [isDirty, setDirty] = useState(false);
    const [pending, setPending] = useState<(() => void) | null>(null);

    // Held in a ref as well as in state: the `beforeunload` listener is registered once and must
    // read the *current* flag, not the one captured when it was attached.
    const dirtyRef = useRef(false);

    const markDirty = useCallback(() => {
        dirtyRef.current = true;
        setDirty(true);
    }, []);

    const markClean = useCallback(() => {
        dirtyRef.current = false;
        setDirty(false);
    }, []);

    useEffect(() => {
        if (!enabled || Platform.OS !== 'web') return;
        if (typeof window === 'undefined') return;

        const handler = (event: BeforeUnloadEvent) => {
            if (!dirtyRef.current) return;
            event.preventDefault();
            // Assigning `returnValue` is what still arms the prompt in Safari and older Chrome;
            // `preventDefault()` alone is the modern spelling and both are cheap.
            event.returnValue = message;
        };

        window.addEventListener('beforeunload', handler);
        return () => {
            window.removeEventListener('beforeunload', handler);
        };
    }, [enabled, message]);

    const intercept = useCallback(
        (navigate: () => void): boolean => {
            if (!enabled || !dirtyRef.current) {
                navigate();
                return true;
            }
            // Stored as a thunk-returning setter: `setState` treats a bare function as an updater.
            setPending(() => navigate);
            return false;
        },
        [enabled],
    );

    const confirmDiscard = useCallback(() => {
        const navigate = pending;
        dirtyRef.current = false;
        setDirty(false);
        setPending(null);
        navigate?.();
    }, [pending]);

    const cancelDiscard = useCallback(() => {
        setPending(null);
    }, []);

    return {
        isDirty,
        markDirty,
        markClean,
        intercept,
        isPrompting: pending !== null,
        confirmDiscard,
        cancelDiscard,
    };
}

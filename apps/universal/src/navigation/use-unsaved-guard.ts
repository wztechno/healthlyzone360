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
    /**
     * The editor keeps its unsaved work as a session draft and restores it on return — the recipe
     * and ingredient editors. Leaving it through the app's own chrome (the sidebar, the page search,
     * a crumb) then asks nothing: the work is kept, and the top bar's Continue leads back to it.
     * A function when it depends on state the guard is created before — read at navigation time.
     */
    readonly keepsDraft?: boolean | (() => boolean) | undefined;
}

/**
 * The guards of the editors on screen, for the chrome to ask before it navigates.
 *
 * The rail, the page search and the crumbs are drawn by the shell, outside every editor, so they
 * cannot call an editor's `intercept` themselves — and on their own they replaced the page with no
 * question, losing whatever was typed (2026-10-26). Each guard registers here while it is mounted;
 * `guardNavigation` runs the chrome's navigation through the first one that has something to lose.
 */
interface RegisteredGuard {
    readonly isDirty: () => boolean;
    readonly keepsDraft: () => boolean;
    readonly intercept: (navigate: () => void) => boolean;
}

const registered = new Set<RegisteredGuard>();

/**
 * Navigates for the app's chrome — a sidebar item, a page-search result, a crumb — through the
 * unsaved guard of the editor on screen. An editor that keeps a draft lets the reader go; one that
 * does not opens its "Leave without saving?" confirmation first.
 */
export function guardNavigation(navigate: () => void): void {
    for (const guard of registered) {
        if (!guard.keepsDraft() && guard.isDirty()) {
            guard.intercept(navigate);
            return;
        }
    }
    navigate();
}

export function useUnsavedGuard({
    message,
    enabled = true,
    keepsDraft = false,
}: UnsavedGuardOptions): UnsavedGuard {
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

    // Registered for the chrome while mounted; read through refs, so one entry serves the lifetime.
    const interceptRef = useRef(intercept);
    const keepsDraftRef = useRef(keepsDraft);
    useEffect(() => {
        interceptRef.current = intercept;
        keepsDraftRef.current = keepsDraft;
    });
    useEffect(() => {
        if (!enabled) return;
        const entry: RegisteredGuard = {
            isDirty: () => dirtyRef.current,
            keepsDraft: () => {
                const keeps = keepsDraftRef.current;
                return typeof keeps === 'function' ? keeps() : keeps;
            },
            intercept: (navigate) => interceptRef.current(navigate),
        };
        registered.add(entry);
        return () => {
            registered.delete(entry);
        };
    }, [enabled]);

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

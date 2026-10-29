import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Dirty tracking, plus the ways a person leaves an editor without saving.
 *
 * ## Why this is a hook rather than a `<Prompt>` component
 *
 * The exits are structurally different and none can be expressed as rendered output. Closing the
 * tab is a synchronous browser event that must be answered *before* React hears about it, the
 * browser's Back arrow is a history traversal the router has already acted on by the time a
 * component renders, and navigating away is an intent the application raises itself. So the hook
 * owns the flag and exposes an `intercept` the screen calls in place of `router.push` — a component
 * would have to guess which navigations belonged to it.
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
    /**
     * Whether the confirmation may offer "Keep for later": the editor keeps a draft and nothing
     * unsaved lies outside it.
     */
    readonly canKeep: boolean;
    /** Keeps the work for later (`onKeep`) and runs whatever navigation was intercepted. */
    readonly confirmKeep: () => void;
}

export interface UnsavedGuardOptions {
    /** Copy shown by platforms that honour a custom message. Browsers substitute their own. */
    readonly message: string;
    /** Set `false` to disable the guard entirely — a read-only screen, a closed editor. */
    readonly enabled?: boolean | undefined;
    /**
     * The editor keeps its unsaved work as a session draft and restores it on return — the recipe
     * and ingredient editors. Its confirmation then offers "Keep for later" beside Discard and Stay.
     * A function when it depends on state the guard is created before — read when it asks.
     */
    readonly keepsDraft?: boolean | (() => boolean) | undefined;
    /** "Keep for later" was chosen: list the work so the reader can come back (`kept-work.ts`). */
    readonly onKeep?: (() => void) | undefined;
    /** "Discard" was chosen: throw away whatever draft the editor keeps, before it navigates. */
    readonly onDiscard?: (() => void) | undefined;
}

/**
 * The guards of the editors on screen, for the chrome to ask before it navigates.
 *
 * The rail, the page search and the crumbs are drawn by the shell, outside every editor, so they
 * cannot call an editor's `intercept` themselves — and on their own they replaced the page with no
 * question, losing whatever was typed (2026-10-26). Each guard registers here while it is mounted;
 * `guardNavigation` runs the chrome's navigation through the first one that has something to lose.
 *
 * An editor that keeps a draft used to be let go without a word, and the reader took the kept work
 * for lost (2026-10-29). Every dirty editor now asks; one that keeps a draft offers to keep it.
 */
interface RegisteredGuard {
    readonly isDirty: () => boolean;
    readonly intercept: (navigate: () => void) => boolean;
}

const registered = new Set<RegisteredGuard>();

function firstDirty(): RegisteredGuard | undefined {
    for (const guard of registered) {
        if (guard.isDirty()) return guard;
    }
    return undefined;
}

/**
 * Navigates for the app's chrome — a sidebar item, a page-search result, a crumb — through the
 * unsaved guard of the editor on screen, which opens its "Leave this page?" confirmation first.
 */
export function guardNavigation(navigate: () => void): void {
    const guard = firstDirty();
    if (guard === undefined) navigate();
    else guard.intercept(navigate);
}

/*
 * ── the browser's Back and Forward ────────────────────────────────────────────────────────────
 *
 * The router hears `popstate` and swaps the page before any component can ask. So one listener
 * hears it first and, with an editor dirty, stops it from reaching the router, steps the history
 * back to the entry the reader was on, and lets the editor ask. Leaving then replays the same step
 * with the listener out of the way.
 *
 * "First" is by registration order: Brave runs a window's `popstate` listeners in the order they
 * were added, capture or not (2026-10-29). So the listener is added when this module is first
 * evaluated, which the root layout makes happen before the router mounts (`app/_layout.tsx`).
 *
 * Which way the reader stepped comes from the Navigation API, which names the entry a traversal
 * left; without it a step is taken to be Back, by far the common case.
 */

interface NavigationEntryLike {
    readonly index: number;
}
interface NavigationLike {
    readonly currentEntry: NavigationEntryLike | null;
    readonly addEventListener: (
        type: 'currententrychange',
        listener: (event: {
            readonly navigationType: string | null;
            readonly from: NavigationEntryLike;
        }) => void,
    ) => void;
}

/** Its own undo steps, kept from the router too — as far as the router knows, nothing moved. */
let swallow = 0;
/** Leaves the reader confirmed, let through to the router. */
let passThrough = 0;
/** The entry the last traversal left, read when its `popstate` arrives. */
let traversedFrom: number | null = null;

function onPopState(event: PopStateEvent, navigation: NavigationLike | undefined): void {
    if (swallow > 0) {
        swallow -= 1;
        event.stopImmediatePropagation();
        return;
    }
    if (passThrough > 0) {
        passThrough -= 1;
        return;
    }
    const guard = firstDirty();
    if (guard === undefined) return;
    event.stopImmediatePropagation();
    const index = navigation?.currentEntry?.index ?? null;
    const step = traversedFrom !== null && index !== null ? index - traversedFrom : -1;
    if (step === 0) return;
    swallow += 1;
    window.history.go(-step);
    guard.intercept(() => {
        passThrough += 1;
        window.history.go(step);
    });
}

/** Added once, for the life of the page. Exported for the root layout to evaluate early. */
export function watchBrowserHistory(): void {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const scope = window as unknown as {
        __h360HistoryWatched?: boolean;
        navigation?: NavigationLike;
    };
    if (scope.__h360HistoryWatched === true) return;
    scope.__h360HistoryWatched = true;
    const navigation = scope.navigation;
    navigation?.addEventListener('currententrychange', (event) => {
        traversedFrom = event.navigationType === 'traverse' ? event.from.index : null;
    });
    window.addEventListener('popstate', (event) => {
        onPopState(event, navigation);
    });
}

watchBrowserHistory();

export function useUnsavedGuard({
    message,
    enabled = true,
    keepsDraft = false,
    onKeep,
    onDiscard,
}: UnsavedGuardOptions): UnsavedGuard {
    const [isDirty, setDirty] = useState(false);
    const [pending, setPending] = useState<(() => void) | null>(null);
    const [canKeep, setCanKeep] = useState(false);

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

    // The options in refs: read when the reader chooses, so a re-render never swaps them mid-prompt.
    const keepsDraftRef = useRef(keepsDraft);
    const onKeepRef = useRef(onKeep);
    const onDiscardRef = useRef(onDiscard);
    useEffect(() => {
        keepsDraftRef.current = keepsDraft;
        onKeepRef.current = onKeep;
        onDiscardRef.current = onDiscard;
    });

    const intercept = useCallback(
        (navigate: () => void): boolean => {
            if (!enabled || !dirtyRef.current) {
                navigate();
                return true;
            }
            const keeps = keepsDraftRef.current;
            setCanKeep(typeof keeps === 'function' ? keeps() : keeps);
            // Stored as a thunk-returning setter: `setState` treats a bare function as an updater.
            setPending(() => navigate);
            return false;
        },
        [enabled],
    );

    // Registered for the chrome while mounted; read through a ref, so one entry serves the lifetime.
    const interceptRef = useRef(intercept);
    useEffect(() => {
        interceptRef.current = intercept;
    });
    useEffect(() => {
        if (!enabled) return;
        const entry: RegisteredGuard = {
            isDirty: () => dirtyRef.current,
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
        onDiscardRef.current?.();
        navigate?.();
    }, [pending]);

    const confirmKeep = useCallback(() => {
        const navigate = pending;
        // Not marked clean: the work is kept, not settled. Only the leave is let through.
        setPending(null);
        onKeepRef.current?.();
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
        canKeep,
        confirmKeep,
    };
}

/**
 * The guard for a form whose dirtiness is already a value it holds — a basket that is not empty, a
 * `touched` flag — rather than something it marks keystroke by keystroke. Follows `dirty`.
 */
export function useUnsavedGuardFor(dirty: boolean, options: UnsavedGuardOptions): UnsavedGuard {
    const guard = useUnsavedGuard(options);
    const { markDirty, markClean } = guard;
    useEffect(() => {
        if (dirty) markDirty();
        else markClean();
    }, [dirty, markDirty, markClean]);
    return guard;
}

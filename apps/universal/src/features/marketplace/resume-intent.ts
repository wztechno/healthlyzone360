import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * "Take me back to where I was."
 *
 * A person browsing the public marketplace who presses *Sign in* has stated an intention about a
 * page, not about authentication. Losing that intention is the single most common way a marketplace
 * wastes the interest it just earned: they sign in, land on a home screen, and have to find the
 * kitchen again.
 *
 * ## Why this is a client-side store and not `?next=`
 *
 * The obvious mechanism — a `?next=` parameter round-tripped through the sign-in screen — is an
 * explicitly recorded gap for this phase (plan §1), because it touches the authentication screens
 * and the gate redirects, which this wave does not own. So the intent is held on the client only:
 * it survives a client-side navigation (which is what the sign-in flow actually is) and is
 * deliberately *not* a routing mechanism. Nothing redirects automatically. The consumer home offers
 * a "Continue to …" control and the person decides.
 *
 * ## Why `sessionStorage` and not the persisted key-value store
 *
 * A browsing intention is a property of *this visit*. Writing it to durable storage would mean a
 * person who signed in a week later being offered a kitchen they have long forgotten, and it would
 * put a browsing trail on disk for no benefit. `sessionStorage` dies with the tab, which is exactly
 * the lifetime the fact has. On native there is no equivalent and the in-memory copy is the whole
 * store — correct there too, since the application is not reloaded mid-flow.
 */
export interface ResumeIntent {
    /** Where to go back to. Always an in-application path. */
    readonly href: string;
    /** i18n key naming the *kind* of destination, e.g. `marketplace:nav.kitchens`. */
    readonly labelKey: string;
    /** The specific thing, when there is one — a kitchen or a dietitian's name. */
    readonly name?: string | undefined;
    readonly recordedAt: string;
}

const STORAGE_KEY = 'healthy360.resume-intent';

let current: ResumeIntent | null = null;
const listeners = new Set<() => void>();

function webStorage(): Storage | null {
    if (Platform.OS !== 'web') return null;
    try {
        return globalThis.sessionStorage;
    } catch {
        // Storage can be unavailable — a hardened browser profile, or a sandboxed iframe. The
        // in-memory copy still works, so this is a degradation rather than a failure.
        return null;
    }
}

function read(): ResumeIntent | null {
    if (current !== null) return current;

    const storage = webStorage();
    if (storage === null) return null;

    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            typeof (parsed as ResumeIntent).href === 'string' &&
            typeof (parsed as ResumeIntent).labelKey === 'string'
        ) {
            current = parsed as ResumeIntent;
            return current;
        }
    } catch {
        /* A corrupt entry is discarded rather than crashing a screen over a breadcrumb. */
    }
    return null;
}

function emit(): void {
    for (const listener of listeners) listener();
}

export function recordResumeIntent(
    intent: Omit<ResumeIntent, 'recordedAt'> & { readonly recordedAt?: string },
): void {
    const next: ResumeIntent = {
        href: intent.href,
        labelKey: intent.labelKey,
        ...(intent.name === undefined ? {} : { name: intent.name }),
        recordedAt: intent.recordedAt ?? new Date().toISOString(),
    };
    current = next;
    webStorage()?.setItem(STORAGE_KEY, JSON.stringify(next));
    emit();
}

export function clearResumeIntent(): void {
    current = null;
    webStorage()?.removeItem(STORAGE_KEY);
    emit();
}

export function getResumeIntent(): ResumeIntent | null {
    return read();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Reactive read. The server snapshot is `null`: a pre-rendered page has no browsing history. */
export function useResumeIntent(): ResumeIntent | null {
    return useSyncExternalStore(subscribe, read, () => null);
}

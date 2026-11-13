import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * Work in progress that has to outlive its screen — a plan being set up, an account closure half
 * way through, a basket add waiting for a sign-in.
 *
 * Every `/customer/*` page is a sibling inside one `<Slot/>`, so moving to the next step or taking a
 * detour unmounts the screen and `useState` starts over. Short, non-personal choices go in the URL
 * instead; this store is for what does not belong there — free text, or more fields than a URL
 * should carry.
 *
 * ## Why `sessionStorage`
 *
 * The same reasoning as `features/marketplace/resume-intent.ts`, which this generalises: a draft is a
 * property of *this visit*. It survives a refresh and a detour, dies with the tab, and never lands on
 * disk for somebody else to find. On native there is no equivalent and the in-memory copy is the
 * whole store — correct there too, since the application is not reloaded mid-flow.
 *
 * Every draft is cleared on sign-out ({@link clearAllSessionDrafts}): it belonged to the person who
 * was signed in.
 */

const PREFIX = 'healthy360.draft.';

interface Envelope<T> {
    readonly value: T;
    readonly savedAt: number;
}

export interface SessionDraftStore<T> {
    read: (key: string) => T | null;
    write: (key: string, value: T) => void;
    clear: (key: string) => void;
    /** Reactive read. */
    useDraft: (key: string) => T | null;
}

export interface SessionDraftOptions<T> {
    /** Unique per kind of draft — `configurator`, `closure`, `pendingAdd`. */
    readonly namespace: string;
    /** Validates what was stored. A draft that no longer parses is discarded, not trusted. */
    readonly parse: (raw: unknown) => T | null;
    /** Older drafts are discarded on read. Omit to keep one for the life of the tab. */
    readonly maxAgeMs?: number | undefined;
}

function webStorage(): Storage | null {
    if (Platform.OS !== 'web') return null;
    try {
        return globalThis.sessionStorage ?? null;
    } catch {
        // A hardened profile or a sandboxed frame. The in-memory copy still works.
        return null;
    }
}

const memory = new Map<string, Envelope<unknown>>();
const listeners = new Set<() => void>();
/** Bumped on every write so `useSyncExternalStore` sees a change. */
let version = 0;

function emit(): void {
    version += 1;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function readEnvelope(storageKey: string): Envelope<unknown> | null {
    const cached = memory.get(storageKey);
    if (cached !== undefined) return cached;

    const storage = webStorage();
    if (storage === null) return null;
    try {
        const raw = storage.getItem(storageKey);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            'value' in parsed &&
            typeof (parsed as { savedAt?: unknown }).savedAt === 'number'
        ) {
            const envelope = parsed as Envelope<unknown>;
            memory.set(storageKey, envelope);
            return envelope;
        }
    } catch {
        /* A corrupt entry is discarded rather than crashing a screen over a draft. */
    }
    return null;
}

function removeKey(storageKey: string): void {
    memory.delete(storageKey);
    try {
        webStorage()?.removeItem(storageKey);
    } catch {
        /* Nothing to undo. */
    }
}

export function createSessionDraftStore<T>({
    namespace,
    parse,
    maxAgeMs,
}: SessionDraftOptions<T>): SessionDraftStore<T> {
    const storageKeyOf = (key: string) => `${PREFIX}${namespace}.${key}`;

    const read = (key: string): T | null => {
        const storageKey = storageKeyOf(key);
        const envelope = readEnvelope(storageKey);
        if (envelope === null) return null;
        if (maxAgeMs !== undefined && Date.now() - envelope.savedAt > maxAgeMs) {
            removeKey(storageKey);
            return null;
        }
        const value = parse(envelope.value);
        if (value === null) removeKey(storageKey);
        return value;
    };

    const write = (key: string, value: T): void => {
        const storageKey = storageKeyOf(key);
        const envelope: Envelope<T> = { value, savedAt: Date.now() };
        memory.set(storageKey, envelope);
        try {
            webStorage()?.setItem(storageKey, JSON.stringify(envelope));
        } catch {
            /* Quota or a blocked store: the in-memory copy carries the visit. */
        }
        emit();
    };

    const clear = (key: string): void => {
        removeKey(storageKeyOf(key));
        emit();
    };

    const useDraft = (key: string): T | null => {
        // The snapshot is the version, not the value: `parse` builds a new object on every read,
        // and a fresh object per render would make `useSyncExternalStore` loop.
        useSyncExternalStore(
            subscribe,
            () => version,
            () => 0,
        );
        return read(key);
    };

    return { read, write, clear, useDraft };
}

/**
 * Forgets one draft by its namespace and key, from outside the screen that owns its store — the
 * top bar's kept work throwing away a recipe the reader is no longer on (`kept-work.ts`).
 */
export function clearSessionDraft(namespace: string, key: string): void {
    removeKey(`${PREFIX}${namespace}.${key}`);
    emit();
}

/** Forgets every draft — called on sign-out. */
export function clearAllSessionDrafts(): void {
    for (const key of [...memory.keys()]) {
        if (key.startsWith(PREFIX)) memory.delete(key);
    }
    const storage = webStorage();
    if (storage !== null) {
        try {
            const keys: string[] = [];
            for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index);
                if (key !== null && key.startsWith(PREFIX)) keys.push(key);
            }
            for (const key of keys) storage.removeItem(key);
        } catch {
            /* Nothing more can be done. */
        }
    }
    emit();
}

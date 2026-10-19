import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { clearAllSessionDrafts, createSessionDraftStore } from './session-draft.ts';

/**
 * The session draft store: work in progress that has to outlive the screen holding it.
 *
 * Jest runs as a phone (`Platform.OS` is `ios` under jest-expo), so most of these cases exercise
 * the in-memory path — which is the *whole* store on native. The web cases switch the platform and
 * stand in a `sessionStorage` of their own, so what is asserted there is what a refresh would find.
 */

interface Note {
    readonly text: string;
    readonly count: number;
}

function parseNote(raw: unknown): Note | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const { text, count } = raw as Partial<Note>;
    return typeof text === 'string' && typeof count === 'number' ? { text, count } : null;
}

const PREFIX = 'healthy360.draft.';

afterEach(() => {
    clearAllSessionDrafts();
    jest.restoreAllMocks();
});

describe('a session draft, in memory', () => {
    it('reads back what was written, per key, until it is cleared', () => {
        const notes = createSessionDraftStore<Note>({ namespace: 'notes', parse: parseNote });

        expect(notes.read('a')).toBeNull();
        notes.write('a', { text: 'first', count: 1 });
        notes.write('b', { text: 'second', count: 2 });

        expect(notes.read('a')).toEqual({ text: 'first', count: 1 });
        expect(notes.read('b')).toEqual({ text: 'second', count: 2 });

        notes.clear('a');
        expect(notes.read('a')).toBeNull();
        expect(notes.read('b')).toEqual({ text: 'second', count: 2 });
    });

    it('keeps two kinds of draft apart, even under the same key', () => {
        const notes = createSessionDraftStore<Note>({ namespace: 'notes', parse: parseNote });
        const others = createSessionDraftStore<Note>({ namespace: 'others', parse: parseNote });

        notes.write('plan:1', { text: 'mine', count: 1 });
        expect(others.read('plan:1')).toBeNull();

        others.write('plan:1', { text: 'theirs', count: 2 });
        expect(notes.read('plan:1')).toEqual({ text: 'mine', count: 1 });
    });

    it('discards a draft older than its maximum age, and keeps one that is not', () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
        const notes = createSessionDraftStore<Note>({
            namespace: 'aged',
            parse: parseNote,
            maxAgeMs: 60_000,
        });
        notes.write('a', { text: 'fresh', count: 1 });

        now.mockReturnValue(1_000_000 + 60_000);
        expect(notes.read('a')).toEqual({ text: 'fresh', count: 1 });

        now.mockReturnValue(1_000_000 + 60_001);
        expect(notes.read('a')).toBeNull();

        // Gone, not merely hidden: winding the clock back does not resurrect it.
        now.mockReturnValue(1_000_000);
        expect(notes.read('a')).toBeNull();
    });

    it('discards a draft that no longer parses rather than trusting it', () => {
        let strict = false;
        const notes = createSessionDraftStore<Note>({
            namespace: 'strict',
            parse: (raw) => (strict ? null : parseNote(raw)),
        });
        notes.write('a', { text: 'kept', count: 1 });
        expect(notes.read('a')).toEqual({ text: 'kept', count: 1 });

        strict = true;
        expect(notes.read('a')).toBeNull();
        // Removed on that read — a later, laxer parse does not bring it back.
        strict = false;
        expect(notes.read('a')).toBeNull();
    });

    it('forgets every draft of every kind on sign-out', () => {
        const notes = createSessionDraftStore<Note>({ namespace: 'notes', parse: parseNote });
        const others = createSessionDraftStore<Note>({ namespace: 'others', parse: parseNote });
        notes.write('a', { text: 'one', count: 1 });
        others.write('b', { text: 'two', count: 2 });

        clearAllSessionDrafts();

        expect(notes.read('a')).toBeNull();
        expect(others.read('b')).toBeNull();
    });

    it('re-renders a reader on every write, clear and sign-out', async () => {
        const notes = createSessionDraftStore<Note>({ namespace: 'live', parse: parseNote });
        const { result } = await renderHook(() => notes.useDraft('a'));
        expect(result.current).toBeNull();

        await act(async () => {
            notes.write('a', { text: 'typed', count: 1 });
        });
        expect(result.current).toEqual({ text: 'typed', count: 1 });

        await act(async () => {
            notes.write('a', { text: 'typed again', count: 2 });
        });
        expect(result.current).toEqual({ text: 'typed again', count: 2 });

        await act(async () => {
            notes.clear('a');
        });
        expect(result.current).toBeNull();

        await act(async () => {
            notes.write('a', { text: 'back', count: 3 });
        });
        await act(async () => {
            clearAllSessionDrafts();
        });
        expect(result.current).toBeNull();
    });
});

/* ══ the web: sessionStorage ═══════════════════════════════════════════════════════════════════ */

/** A `Storage` over a Map — enough of the interface for what the store calls. */
function memoryStorage(): Storage {
    const entries = new Map<string, string>();
    return {
        get length() {
            return entries.size;
        },
        key: (index: number) => [...entries.keys()][index] ?? null,
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => {
            entries.set(key, String(value));
        },
        removeItem: (key: string) => {
            entries.delete(key);
        },
        clear: () => {
            entries.clear();
        },
    };
}

describe('a session draft, on the web', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    let storage: Storage;

    beforeEach(() => {
        storage = memoryStorage();
        Object.defineProperty(globalThis, 'sessionStorage', {
            configurable: true,
            get: () => storage,
        });
        jest.replaceProperty(Platform, 'OS', 'web');
    });

    afterEach(() => {
        if (original === undefined) {
            delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
        } else {
            Object.defineProperty(globalThis, 'sessionStorage', original);
        }
    });

    it('writes the draft to the tab’s storage, stamped with when it was saved', () => {
        jest.spyOn(Date, 'now').mockReturnValue(1_234);
        const notes = createSessionDraftStore<Note>({ namespace: 'web', parse: parseNote });
        notes.write('plan:7', { text: 'saved', count: 1 });

        expect(JSON.parse(storage.getItem(`${PREFIX}web.plan:7`) ?? 'null')).toEqual({
            value: { text: 'saved', count: 1 },
            savedAt: 1_234,
        });
    });

    it('reads a draft an earlier load of the page left behind', () => {
        // Nothing in memory for this key: what a refresh starts from.
        storage.setItem(
            `${PREFIX}web.refreshed`,
            JSON.stringify({ value: { text: 'from before', count: 4 }, savedAt: Date.now() }),
        );
        const notes = createSessionDraftStore<Note>({ namespace: 'web', parse: parseNote });

        expect(notes.read('refreshed')).toEqual({ text: 'from before', count: 4 });
    });

    it('ignores an entry that is not one of its own envelopes', () => {
        storage.setItem(`${PREFIX}web.corrupt`, '{not json');
        storage.setItem(`${PREFIX}web.bare`, JSON.stringify({ text: 'no envelope', count: 1 }));
        const notes = createSessionDraftStore<Note>({ namespace: 'web', parse: parseNote });

        expect(notes.read('corrupt')).toBeNull();
        expect(notes.read('bare')).toBeNull();
    });

    it('removes the stored copy on clear, on expiry and on sign-out — and only its own keys', () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(0);
        const notes = createSessionDraftStore<Note>({
            namespace: 'web',
            parse: parseNote,
            maxAgeMs: 10,
        });
        storage.setItem('somebody.else', 'untouched');

        notes.write('cleared', { text: 'a', count: 1 });
        notes.clear('cleared');
        expect(storage.getItem(`${PREFIX}web.cleared`)).toBeNull();

        notes.write('expired', { text: 'b', count: 2 });
        now.mockReturnValue(11);
        expect(notes.read('expired')).toBeNull();
        expect(storage.getItem(`${PREFIX}web.expired`)).toBeNull();

        notes.write('kept', { text: 'c', count: 3 });
        expect(storage.getItem(`${PREFIX}web.kept`)).not.toBeNull();
        clearAllSessionDrafts();
        expect(storage.getItem(`${PREFIX}web.kept`)).toBeNull();
        expect(storage.getItem('somebody.else')).toBe('untouched');
    });

    it('still carries the visit in memory when the browser refuses its storage', () => {
        Object.defineProperty(globalThis, 'sessionStorage', {
            configurable: true,
            get: () => {
                throw new Error('SecurityError: storage is disabled');
            },
        });
        const notes = createSessionDraftStore<Note>({ namespace: 'blocked', parse: parseNote });

        notes.write('a', { text: 'in memory', count: 1 });
        expect(notes.read('a')).toEqual({ text: 'in memory', count: 1 });
        expect(() => {
            clearAllSessionDrafts();
        }).not.toThrow();
        expect(notes.read('a')).toBeNull();
    });
});

import { pathnameOf } from './return-to.ts';
import { clearSessionDraft, createSessionDraftStore } from './session-draft.ts';

/**
 * Editors the reader chose to "Keep for later" on the way out — a new ingredient, a recipe half
 * changed — listed so they can come back to each one.
 *
 * ## Why it is needed
 *
 * The recipe and ingredient editors keep their unsaved work as a session draft when the reader
 * leaves, and put it back when the record is opened again. But nothing said so: leaving looked like
 * losing the work, and finding it again meant remembering which record it was (2026-10-29). The
 * user's choice was to ask on every leave — Keep for later, Discard, Stay — and to show what was
 * kept in a card at the bottom of the page and in the top bar, several at once.
 *
 * ## How it relates to the active process
 *
 * A process (`active-process.ts`) is a path through several pages — a stock gap being fixed — and
 * there is one at a time. Kept work is one page each, as many as the reader keeps. The two are
 * listed together by `useContinuableWork`; a page that is a step of the running process is not kept
 * a second time (`keepWork` is skipped by the editors in that case).
 *
 * Each entry names the draft that holds the work, so throwing the entry away from the card throws
 * the draft away too — otherwise opening the record later would bring the discarded work back.
 */

export const KEPT_WORK_KINDS = ['recipe', 'ingredient', 'packaging'] as const;
export type KeptWorkKind = (typeof KEPT_WORK_KINDS)[number];

export interface KeptWork {
    /** `${kind}:${draftKey}` — one entry per draft. */
    readonly id: string;
    readonly kind: KeptWorkKind;
    /** The record's name as it was when kept, or null for one not created yet. */
    readonly subject: string | null;
    /** Where Continue goes: the editor's own address, its tab and way back included. */
    readonly href: string;
    /** The session draft that holds the work — see `createSessionDraftStore`. */
    readonly draft: { readonly namespace: string; readonly key: string };
    readonly keptAt: number;
}

/** A card of more than this is a list nobody reads; the oldest goes first. */
export const MAX_KEPT_WORK = 8;
const KEY = 'list';
const TWO_HOURS = 2 * 60 * 60 * 1000;

function parseEntry(raw: unknown): KeptWork | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const value = raw as Partial<Record<keyof KeptWork, unknown>>;
    const draft = value.draft as Partial<Record<'namespace' | 'key', unknown>> | null | undefined;
    if (
        typeof value.id !== 'string' ||
        typeof value.kind !== 'string' ||
        !(KEPT_WORK_KINDS as readonly string[]).includes(value.kind) ||
        (value.subject !== null && typeof value.subject !== 'string') ||
        typeof value.href !== 'string' ||
        !value.href.startsWith('/') ||
        typeof draft !== 'object' ||
        draft === null ||
        typeof draft.namespace !== 'string' ||
        typeof draft.key !== 'string' ||
        typeof value.keptAt !== 'number'
    ) {
        return null;
    }
    return {
        id: value.id,
        kind: value.kind as KeptWorkKind,
        subject: value.subject,
        href: value.href,
        draft: { namespace: draft.namespace, key: draft.key },
        keptAt: value.keptAt,
    };
}

function parse(raw: unknown): readonly KeptWork[] | null {
    if (!Array.isArray(raw)) return null;
    return raw.map(parseEntry).filter((entry): entry is KeptWork => entry !== null);
}

const store = createSessionDraftStore<readonly KeptWork[]>({
    namespace: 'keptWork',
    maxAgeMs: TWO_HOURS,
    parse,
});

/** Listeners told when something new is kept — the card opens itself again for it. */
const keptListeners = new Set<() => void>();

export function readKeptWork(): readonly KeptWork[] {
    return store.read(KEY) ?? [];
}

export function useKeptWork(): readonly KeptWork[] {
    return store.useDraft(KEY) ?? [];
}

/** Keeps an editor's work, replacing an older entry for the same draft. Newest first. */
export function keepWork(entry: Omit<KeptWork, 'id' | 'keptAt'>): void {
    const id = `${entry.kind}:${entry.draft.key}`;
    const rest = readKeptWork().filter((kept) => kept.id !== id);
    const next = [{ ...entry, id, keptAt: Date.now() }, ...rest];
    for (const dropped of next.slice(MAX_KEPT_WORK)) {
        clearSessionDraft(dropped.draft.namespace, dropped.draft.key);
    }
    store.write(KEY, next.slice(0, MAX_KEPT_WORK));
    for (const listener of keptListeners) listener();
}

/** The work is saved or discarded on its own page: the entry goes, the draft stays the page's. */
export function forgetKeptWork(kind: KeptWorkKind, draftKey: string): void {
    const id = `${kind}:${draftKey}`;
    const list = readKeptWork();
    if (!list.some((kept) => kept.id === id)) return;
    store.write(
        KEY,
        list.filter((kept) => kept.id !== id),
    );
}

/** The reader threw it away from the card: the entry and the draft behind it both go. */
export function discardKeptWork(id: string): void {
    const list = readKeptWork();
    const entry = list.find((kept) => kept.id === id);
    if (entry === undefined) return;
    clearSessionDraft(entry.draft.namespace, entry.draft.key);
    store.write(
        KEY,
        list.filter((kept) => kept.id !== id),
    );
}

export function onWorkKept(listener: () => void): () => void {
    keptListeners.add(listener);
    return () => {
        keptListeners.delete(listener);
    };
}

/** Kept work that is not the page the reader is on — on its own page there is nothing to resume. */
export function keptWorkAway(list: readonly KeptWork[], pathname: string): readonly KeptWork[] {
    return list.filter((kept) => pathnameOf(kept.href) !== pathname);
}

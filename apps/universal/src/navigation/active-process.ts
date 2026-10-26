import { useEffect } from 'react';

import { pathnameOf } from './return-to.ts';
import { createSessionDraftStore } from './session-draft.ts';

/**
 * The process the reader is in the middle of — fixing a stock gap across Stock gaps, a recipe and
 * an ingredient — kept for the tab, so leaving it is never losing it.
 *
 * ## Why it is needed
 *
 * Where a reader is in such a process lives in the URL: each page carries the way back to the one
 * before as `?returnTo=`. Clicking anything in the sidebar replaces that URL with a bare page, and
 * the chain was gone — with no way back but to start again (2026-10-26). The user's choice was
 * "keep my place": leave freely, and a Continue button in the top bar leads back to the exact step,
 * its return chain intact.
 *
 * ## What it holds
 *
 * One process per tab: what it is, the record it is about (named as it was when it started), the
 * step to resume (`resumeHref`, the full URL of the last step page the reader was on), the page it
 * began on, and the pages that are its steps, on which Continue is not offered — the reader is
 * already there. A page is a step when it was opened *from* the process: its `?returnTo=` is the
 * page the process began on or one of its steps.
 *
 * Kept in session storage through `createSessionDraftStore`, so it survives a reload and goes with
 * the tab; `clearAllSessionDrafts` forgets it on sign-out. Two hours, as the recipe's draft.
 */

export const PROCESS_KINDS = ['stockGapFix', 'recipeDetour'] as const;
export type ProcessKind = (typeof PROCESS_KINDS)[number];

export interface ActiveProcess {
    readonly kind: ProcessKind;
    /** The record the process is about — "Bbq Sauce Dip". */
    readonly subject: string;
    /** Where Continue goes: the step the reader was last on, query and return chain included. */
    readonly resumeHref: string;
    /** The pathname it began on — Stock gaps, or the recipe a detour left. */
    readonly originPath: string;
    /** The pathnames that are steps of it. */
    readonly stepPaths: readonly string[];
}

const KEY = 'current';
const TWO_HOURS = 2 * 60 * 60 * 1000;

function parse(raw: unknown): ActiveProcess | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const value = raw as Partial<Record<keyof ActiveProcess, unknown>>;
    if (
        typeof value.kind !== 'string' ||
        !(PROCESS_KINDS as readonly string[]).includes(value.kind) ||
        typeof value.subject !== 'string' ||
        typeof value.resumeHref !== 'string' ||
        !value.resumeHref.startsWith('/') ||
        typeof value.originPath !== 'string' ||
        !Array.isArray(value.stepPaths) ||
        !value.stepPaths.every((path) => typeof path === 'string')
    ) {
        return null;
    }
    return {
        kind: value.kind as ProcessKind,
        subject: value.subject,
        resumeHref: value.resumeHref,
        originPath: value.originPath,
        stepPaths: value.stepPaths as string[],
    };
}

const store = createSessionDraftStore<ActiveProcess>({
    namespace: 'activeProcess',
    maxAgeMs: TWO_HOURS,
    parse,
});

/** Begins a process, replacing any other: a reader is in one at a time. */
export function startProcess(process: ActiveProcess): void {
    store.write(KEY, process);
}

/** Ends it — the gap is closed, the reader is back where it began, or they chose to stop. */
export function endProcess(): void {
    store.clear(KEY);
}

export function readActiveProcess(): ActiveProcess | null {
    return store.read(KEY);
}

export function useActiveProcess(): ActiveProcess | null {
    return store.useDraft(KEY);
}

/**
 * Marks the page as a step of the active process, and the place Continue returns to.
 *
 * A screen opened as a detour calls it with its own current href (`useCurrentHref`, plus anything
 * only it knows, such as its open tab) and the `returnTo` it was opened with. It is a step only when
 * that `returnTo` leads into the active process — so a record opened from elsewhere, or with no
 * process running, changes nothing. A page opened on its own never starts one.
 */
export function useProcessStep(href: string | null, returnTo: string | null): void {
    useEffect(() => {
        if (href === null || returnTo === null) return;
        const current = store.read(KEY);
        if (current === null) return;
        const from = pathnameOf(returnTo);
        if (from !== current.originPath && !current.stepPaths.includes(from)) return;
        const path = pathnameOf(href);
        const known = current.stepPaths.includes(path);
        if (known && current.resumeHref === href) return;
        store.write(KEY, {
            ...current,
            resumeHref: href,
            stepPaths: known ? current.stepPaths : [...current.stepPaths, path],
        });
    }, [href, returnTo]);
}

/**
 * Whether Continue belongs on this page: there is a process, and this page is not one of its
 * steps — the reader has stepped out of it. Its origin counts as outside: back on Stock gaps by the
 * sidebar, the recipe they were fixing is still one press away.
 */
export function isOutsideProcess(process: ActiveProcess | null, pathname: string): boolean {
    return (
        process !== null &&
        !process.stepPaths.includes(pathname) &&
        pathnameOf(process.resumeHref) !== pathname
    );
}

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { useBreakpoint } from '../hooks/use-breakpoint.ts';

export const ISSUE_TONES = ['danger', 'warning', 'info'] as const;
export type IssueTone = (typeof ISSUE_TONES)[number];

/** What the top bar's pill needs to know about the page's tray: how much is open, and how bad. */
export interface IssueTraySummary {
    /** The cards that still block something — `danger` and `warning`. `info` is never counted. */
    readonly openCount: number;
    /**
     * The worst open tone; `checking` while nothing blocks but something is still being worked out
     * (a cost the server has not answered yet); `clear` once nothing blocks and nothing is pending.
     */
    readonly tone: 'danger' | 'warning' | 'checking' | 'clear';
    /** The tray's own title, so the pill can name what it opens. */
    readonly title: string;
}

/** What a press that could not go through asks the tray to explain. */
export interface BlockedPress {
    /** What was pressed — it titles the notice: "2 things before saving". */
    readonly action: 'save' | 'publish';
    /** The groups whose cards stopped it — `save`, `publish`. Every blocking card when absent. */
    readonly groups?: readonly string[] | undefined;
}

export interface IssueTrayController {
    readonly open: boolean;
    readonly setOpen: (open: boolean) => void;
    readonly toggle: () => void;
    /** The page's tray, or `null` when the page has none — and then the pill is not drawn. */
    readonly summary: IssueTraySummary | null;
    readonly publish: (summary: IssueTraySummary | null) => void;
    /** When a card last cleared itself; the pill flashes green for a moment after it. */
    readonly resolvedAt: number;
    readonly markResolved: () => void;
    /** When something asked to be looked at (a refused save); the pill shakes once. */
    readonly nudgedAt: number;
    readonly nudge: () => void;
    /**
     * A press that could not go through: the tray answers with a notice in the middle of the page
     * naming what stops it, and "Show me" opens the tray on the first card and runs its Fix.
     */
    readonly explain: (press: BlockedPress) => void;
    /** The press being explained, while its notice is open. */
    readonly explaining: BlockedPress | null;
    readonly endExplaining: () => void;
}

const IssueTrayContext = createContext<IssueTrayController | null>(null);

/** The controller of the nearest `IssueTrayFrame`, so a part inside it nudges that tray. */
const FrameControllerContext = createContext<IssueTrayController | null>(null);

export const IssueTrayFrameControllerProvider = FrameControllerContext.Provider;

/**
 * The tray's state, shared by the two places that draw it: the pill in the top bar and the panel
 * beside the page. They are siblings — the bar is the shell's, the panel the screen's — so neither
 * can own the open flag; this does.
 *
 * Open by default from `lg`, where the panel docks beside the form without covering it, and closed
 * below, where it is a bottom sheet that would otherwise cover the page on arrival. Once somebody
 * presses the pill, their choice holds for the rest of the session, on every page.
 */
export function IssueTrayProvider({ children }: { readonly children: ReactNode }) {
    const controller = useIssueTrayState();
    return <IssueTrayContext.Provider value={controller}>{children}</IssueTrayContext.Provider>;
}

function useIssueTrayState(): IssueTrayController {
    const { atLeast } = useBreakpoint();
    const wide = atLeast('lg');
    const [chosen, setChosen] = useState<boolean | null>(null);
    const [summary, setSummary] = useState<IssueTraySummary | null>(null);
    const [resolvedAt, setResolvedAt] = useState(0);
    const [nudgedAt, setNudgedAt] = useState(0);
    const [explaining, setExplaining] = useState<BlockedPress | null>(null);

    const open = chosen ?? wide;
    const setOpen = useCallback((next: boolean) => {
        setChosen(next);
    }, []);
    const toggle = useCallback(() => {
        setChosen((current) => !(current ?? wide));
    }, [wide]);
    const publish = useCallback((next: IssueTraySummary | null) => {
        setSummary((current) =>
            current?.openCount === next?.openCount &&
            current?.tone === next?.tone &&
            current?.title === next?.title
                ? current
                : next,
        );
    }, []);
    const markResolved = useCallback(() => {
        setResolvedAt(Date.now());
    }, []);
    const nudge = useCallback(() => {
        setChosen(true);
        setNudgedAt(Date.now());
    }, []);
    const explain = useCallback((press: BlockedPress) => {
        setExplaining(press);
    }, []);
    const endExplaining = useCallback(() => {
        setExplaining(null);
    }, []);

    return useMemo(
        () => ({
            open,
            setOpen,
            toggle,
            summary,
            publish,
            resolvedAt,
            markResolved,
            nudgedAt,
            nudge,
            explain,
            explaining,
            endExplaining,
        }),
        [
            open,
            setOpen,
            toggle,
            summary,
            publish,
            resolvedAt,
            markResolved,
            nudgedAt,
            nudge,
            explain,
            explaining,
            endExplaining,
        ],
    );
}

/** The shared controller, or `null` outside a provider (a screen rendered on its own, a test). */
export function useIssueTrayContext(): IssueTrayController | null {
    return useContext(IssueTrayContext);
}

/**
 * The controller a tray uses: the shared one when there is a provider, otherwise its own — so a
 * screen rendered without the shell still draws its tray, open from `lg` as it would be in the app.
 *
 * A screen that needs to open its tray — a refused save calls `nudge()` — takes the controller
 * here and hands it to `IssueTrayFrame`, so both are talking about the same tray. Inside a frame —
 * a listing embedded in a recipe's tab — it is that frame's controller, the tray its cards are in.
 */
export function useIssueTrayController(): IssueTrayController {
    const frame = useContext(FrameControllerContext);
    const shared = useContext(IssueTrayContext);
    const local = useIssueTrayState();
    return frame ?? shared ?? local;
}

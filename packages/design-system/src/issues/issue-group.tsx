import { createContext, useContext, useId, useLayoutEffect, useMemo } from 'react';
import type { ReactNode } from 'react';

import type {
    IssueAction,
    IssueCardItem,
    IssueGroup,
    IssueNotes,
    IssuePassedItem,
} from './issue-tray.tsx';

/**
 * Cards a part of the page adds to the tray of the page around it.
 *
 * ```
 *  IssueTrayFrame  ← the page's own groups, then every registered one
 *   └ RecordFormOpening   useIssueGroup({ key: 'save', … })
 *   └ Selling tab         useIssueGroup({ key: 'selling', … })
 * ```
 *
 * The tray is drawn once, by the page's `IssueTrayFrame`, but some of what it says is known only
 * further down — the shared form opening's save chips, a listing embedded in a recipe's tab. Those
 * parts register a group here instead of drawing a banner of their own; the frame merges each one
 * after its own groups, in the panel and in the pill's count.
 *
 * A registration is the part's live state, set again on every render, so its cards clear themselves
 * the way the page's own do. It is keyed per component and removed when that component unmounts —
 * quietly: a part that leaves (a seller switched, a page left) has not fixed anything, so its cards
 * go without ticking green.
 */

export interface RegisteredIssues {
    readonly group: IssueGroup;
    /** Facts with nothing to fix — an import's notes. Drawn after the page's own. */
    readonly notes?: IssueNotes | undefined;
    /** Checks this part has already met, listed with the page's own. */
    readonly passed?: readonly IssuePassedItem[] | undefined;
}

export interface IssueRegistry {
    readonly set: (id: string, entry: RegisteredIssues) => void;
    readonly remove: (id: string) => void;
    readonly subscribe: (listener: () => void) => () => void;
    readonly snapshot: () => readonly RegisteredIssues[];
}

const IssueRegistryContext = createContext<IssueRegistry | null>(null);

export const IssueRegistryProvider = IssueRegistryContext.Provider;

/** The store a frame keeps: entries in the order their parts first registered. */
export function createIssueRegistry(): IssueRegistry {
    const entries = new Map<string, RegisteredIssues>();
    const listeners = new Set<() => void>();
    let snapshot: readonly RegisteredIssues[] = [];
    const emit = () => {
        snapshot = [...entries.values()];
        for (const listener of listeners) listener();
    };
    return {
        set: (id, entry) => {
            // `Map.set` on a known id keeps its place, so a part that re-renders does not move.
            entries.set(id, entry);
            emit();
        },
        remove: (id) => {
            if (!entries.delete(id)) return;
            emit();
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        snapshot: () => snapshot,
    };
}

/**
 * Registers `group` with the nearest `IssueTrayFrame` and answers whether there was one.
 *
 * Without a frame above, nothing is registered and the answer is `false` — the caller draws what it
 * drew before (its banner), so a part rendered on its own still says its problems. Pass `null` to
 * register nothing; a group with no items is still registered, so the cards it had tick as fixed.
 */
export function useIssueGroup(
    group: IssueGroup | null,
    extras?: Omit<RegisteredIssues, 'group'>,
): boolean {
    const registry = useContext(IssueRegistryContext);
    const id = useId();

    // Every render: the cards are derived from live state, and so are their actions.
    useLayoutEffect(() => {
        if (registry === null) return;
        if (group === null) {
            registry.remove(id);
            return;
        }
        registry.set(id, { group, notes: extras?.notes, passed: extras?.passed });
    });

    useLayoutEffect(
        () => () => {
            registry?.remove(id);
        },
        [registry, id],
    );

    return registry !== null;
}

/**
 * Wraps a part of the page that may be hidden — a tab's content kept mounted on the other tabs —
 * so every card it registers first `reveal`s it: the tab switches, then the card's own Fix scrolls
 * and focuses as it always does, a frame later (`focusField`).
 */
export function IssueRevealScope({
    reveal,
    children,
}: {
    readonly reveal: () => void;
    readonly children: ReactNode;
}) {
    const parent = useContext(IssueRegistryContext);
    const scoped = useMemo<IssueRegistry | null>(() => {
        if (parent === null) return null;
        const wrap = (action: IssueAction | undefined): IssueAction | undefined =>
            action === undefined
                ? undefined
                : {
                      ...action,
                      onPress: () => {
                          reveal();
                          action.onPress();
                      },
                  };
        const wrapItem = (item: IssueCardItem): IssueCardItem => ({
            ...item,
            action: wrap(item.action),
            secondaryAction: wrap(item.secondaryAction),
        });
        return {
            ...parent,
            set: (id, entry) => {
                parent.set(id, {
                    ...entry,
                    group: { ...entry.group, items: entry.group.items.map(wrapItem) },
                });
            },
        };
    }, [parent, reveal]);
    return <IssueRegistryProvider value={scoped}>{children}</IssueRegistryProvider>;
}

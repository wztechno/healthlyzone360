import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import type { IssueAction, IssueCardItem, IssueGroup, IssuePassedItem } from './issue-tray.tsx';

/**
 * The tray laid inline: a page whose tray is `placement: 'inline'` draws no panel beside it. Each
 * card is drawn instead where its problem is — beside the title of the section it names
 * (`IssueCardItem.anchor`), as one small button that takes the reader to the field. A card with no
 * anchor is drawn by {@link IssueUnanchored}, which the page places once, under its opening.
 *
 * The frame merges the page's own groups with what the parts inside it registered
 * (`useIssueGroup`), exactly as it does for the panel, and hands the result down here — so a
 * listing embedded in a tab anchors its cards to its own sections without knowing which layout the
 * page chose.
 */
export interface InlineIssues {
    readonly groups: readonly IssueGroup[];
    readonly passed: readonly IssuePassedItem[];
    /** The clear tray's next step — "Back to stock gaps" once a fix is published. */
    readonly doneAction?: IssueAction | undefined;
}

const InlineIssuesContext = createContext<InlineIssues | null>(null);

export function InlineIssuesProvider({
    value,
    children,
}: {
    readonly value: InlineIssues | null;
    readonly children: ReactNode;
}) {
    return <InlineIssuesContext.Provider value={value}>{children}</InlineIssuesContext.Provider>;
}

/** Every open card on an inline page, in tray order. Empty outside one. */
export function useInlineIssues(): {
    readonly items: readonly IssueCardItem[];
    readonly blocking: readonly IssueCardItem[];
    readonly passedCount: number;
    readonly inline: boolean;
} {
    const value = useContext(InlineIssuesContext);
    return useMemo(() => {
        const items = (value?.groups ?? []).flatMap((group) => group.items);
        return {
            items,
            blocking: items.filter((item) => item.tone !== 'info'),
            passedCount: value?.passed.length ?? 0,
            inline: value !== null,
        };
    }, [value]);
}

function IssueChip({
    item,
    withDetail = false,
}: {
    readonly item: IssueCardItem;
    /**
     * Says the card's `detail` too. A chip beside its section leaves it out — the detail names
     * where the problem is, and the section's title already does — but a loose one may be the
     * only place a refusal's own words are said ("The kitchen is closed.").
     */
    readonly withDetail?: boolean;
}) {
    /*
     * The board's `.fx`, for every open problem — a heads-up too: an amber pill, a white "!" in a
     * strong amber disc, the problem in 12px semibold. Loud on purpose; a dashed grey chip was
     * missed.
     */
    const action = item.action;
    const detail = withDetail ? item.detail : undefined;
    const body = (
        <>
            <View
                aria-hidden
                className="h-5 w-5 items-center justify-center rounded-full bg-warning-strong"
            >
                <RNText className="text-role-caption font-extrabold text-warning-on-strong">
                    !
                </RNText>
            </View>
            <RNText
                numberOfLines={detail === undefined ? 1 : 2}
                className="shrink text-role-caption font-semibold text-warning-on-subtle"
            >
                {/* The panel's handle for a card's words, so either layout is found the same way. */}
                <RNText testID={item.testID === undefined ? undefined : `${item.testID}-label`}>
                    {item.label}
                </RNText>
                {detail === undefined ? null : (
                    <RNText className="font-normal">{` · ${detail}`}</RNText>
                )}
            </RNText>
        </>
    );
    const shape = cx(
        'max-w-full flex-row items-center gap-1.5 rounded-full border border-transparent bg-warning-subtle pe-2.5 ps-1',
        detail === undefined ? 'h-7' : 'min-h-7 py-1',
    );
    /*
     * The card's testIDs as the panel gives them, so a suite (and a reader of the DOM) finds the
     * same handles in either layout: the card itself, its Fix (`-fix`, or the action's own), and
     * a second way out beside it.
     */
    const secondary = item.secondaryAction;
    return (
        <View testID={item.testID} className="max-w-full flex-row items-center gap-1">
            {action === undefined ? (
                <View className={shape}>{body}</View>
            ) : (
                <Pressable
                    testID={
                        action.testID ??
                        (item.testID === undefined ? undefined : `${item.testID}-fix`)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={
                        item.detail === undefined ? item.label : `${item.label}, ${item.detail}`
                    }
                    disabled={action.loading === true}
                    onPress={action.onPress}
                    className={cx(shape, 'web:hover:border-warning-border')}
                >
                    {body}
                    {action.label === undefined ? null : (
                        <RNText className="text-role-caption font-bold text-content-primary">
                            {`· ${action.label}`}
                        </RNText>
                    )}
                </Pressable>
            )}
            {secondary === undefined ? null : (
                <Pressable
                    testID={secondary.testID}
                    accessibilityRole="button"
                    onPress={secondary.onPress}
                    className="h-6 flex-row items-center rounded-full px-2 web:hover:bg-surface-sunken"
                >
                    <RNText className="text-role-caption font-semibold text-content-secondary">
                        {secondary.label ?? item.label}
                    </RNText>
                </Pressable>
            )}
        </View>
    );
}

/** The open cards that name this section, as buttons beside its title. Nothing when there are none. */
export function IssueAnchor({
    anchor,
    testID,
}: {
    readonly anchor: string | readonly string[];
    readonly testID?: string | undefined;
}) {
    const { items } = useInlineIssues();
    const keys = typeof anchor === 'string' ? [anchor] : anchor;
    const here = items.filter((item) => item.anchor !== undefined && keys.includes(item.anchor));
    if (here.length === 0) return null;
    return (
        <View
            testID={testID}
            className="min-w-0 shrink flex-row flex-wrap items-center gap-1 self-center"
        >
            {here.map((item) => (
                <IssueChip key={item.key} item={item} />
            ))}
        </View>
    );
}

/**
 * The open cards no section claims, in one row — placed once, under the page's opening. With
 * nothing open at all it carries the tray's next step instead, if the page gave one.
 */
export function IssueUnanchored({ testID }: { readonly testID?: string | undefined }) {
    const value = useContext(InlineIssuesContext);
    const { items } = useInlineIssues();
    // By group, each under the group's own handle — the panel's — so a group is found as one.
    const groups = (value?.groups ?? [])
        .map((group) => ({ group, loose: group.items.filter((item) => item.anchor === undefined) }))
        .filter((entry) => entry.loose.length > 0);
    const done = items.length === 0 ? value?.doneAction : undefined;
    if (groups.length === 0 && done === undefined) return null;
    return (
        <View testID={testID} className="flex-row flex-wrap items-center gap-1">
            {groups.map(({ group, loose }) => (
                <View
                    key={group.key}
                    testID={group.testID}
                    className="max-w-full flex-row flex-wrap items-center gap-1"
                >
                    {loose.map((item) => (
                        <IssueChip key={item.key} item={item} withDetail />
                    ))}
                </View>
            ))}
            {done === undefined ? null : (
                <Pressable
                    testID={done.testID}
                    accessibilityRole="button"
                    onPress={done.onPress}
                    className="h-7 flex-row items-center gap-1 rounded-full bg-surface-brand-subtle px-3 web:hover:bg-surface-brand-subtle"
                >
                    <Icon name="check" size="sm" className="text-content-on-brand-subtle" />
                    <RNText className="text-role-caption font-semibold text-content-on-brand-subtle">
                        {done.label}
                    </RNText>
                </Pressable>
            )}
        </View>
    );
}

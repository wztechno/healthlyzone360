import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

/**
 * `.gh2` — a heading row inside a list, spanning the table (Orders canvas, 2026-11-10).
 *
 * ```
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ Late from earlier days  Still open                     43 orders  See all │  tone="danger"
 * │ Breakfast  08:00–10:00                                           2 orders │
 * ```
 *
 * It owns its ground — sunken, or the danger tint for a group that is itself a warning — so it is
 * passed to `CatalogueList`'s `sectionHeader` as it is; the list draws only the rule above it.
 */
export function ListGroupRow({
    title,
    sub,
    count,
    tone = 'neutral',
    action,
    testID,
}: {
    readonly title: string;
    readonly sub?: string | null | undefined;
    /** Already worded — "43 orders". */
    readonly count?: string | undefined;
    readonly tone?: 'neutral' | 'danger' | undefined;
    /** A way on from the heading — "See all". */
    readonly action?: ReactNode;
    readonly testID?: string | undefined;
}) {
    const danger = tone === 'danger';
    const ink = danger ? 'text-danger-on-subtle' : 'text-content-primary';
    const quiet = danger ? 'text-danger-on-subtle' : 'text-content-secondary';
    return (
        <View
            testID={testID}
            className={`min-h-[42px] flex-row items-center gap-2.5 px-[14px] py-1 ${
                danger ? 'bg-danger-subtle' : 'bg-surface-sunken'
            }`}
        >
            <RNText className={`text-sm font-bold ${ink}`}>{title}</RNText>
            {sub === null || sub === undefined ? null : (
                <RNText className={`text-xs font-semibold tabular-nums ${quiet}`}>{sub}</RNText>
            )}
            <View className="ms-auto flex-row items-center gap-2.5">
                {count === undefined ? null : (
                    <RNText className={`text-xs font-semibold tabular-nums ${quiet}`}>
                        {count}
                    </RNText>
                )}
                {action}
            </View>
        </View>
    );
}

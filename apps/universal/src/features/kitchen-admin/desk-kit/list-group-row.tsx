import { Icon } from '@healthy360/design-system';
import { Pressable, Text as RNText, View } from 'react-native';

/**
 * `.gh2` — a heading row inside a list, spanning the table (Orders canvas, 2026-11-10).
 *
 * ```
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ Late from earlier days  Still open                   43 orders  See all › │  tone="danger", onPress
 * │ Breakfast  08:00–10:00                                           2 orders │
 * ```
 *
 * It owns its ground — sunken, or the danger tint for a group that is itself a warning — so it is
 * passed to `CatalogueList`'s `sectionHeader` as it is; the list draws only the rule above it.
 *
 * With `onPress` the whole row is the way on, like an order row under it: it takes the hover and
 * the press, and `actionLabel` ("See all ›") says where it goes. The label is words on the row,
 * never a button inside it — a button cannot hold a button.
 */
export function ListGroupRow({
    title,
    sub,
    count,
    tone = 'neutral',
    onPress,
    actionLabel,
    accessibilityLabel,
    actionTestID,
    testID,
}: {
    readonly title: string;
    readonly sub?: string | null | undefined;
    /** Already worded — "43 orders". */
    readonly count?: string | undefined;
    readonly tone?: 'neutral' | 'danger' | undefined;
    /** Makes the whole row a link — the late group's "See all". */
    readonly onPress?: (() => void) | undefined;
    /** Translated — the words at the row's end that say where a press goes. */
    readonly actionLabel?: string | undefined;
    /** Translated — the row's name as a link. Defaults to the title and the action. */
    readonly accessibilityLabel?: string | undefined;
    readonly actionTestID?: string | undefined;
    readonly testID?: string | undefined;
}) {
    const danger = tone === 'danger';
    const ink = danger ? 'text-danger-on-subtle' : 'text-content-primary';
    const quiet = danger ? 'text-danger-on-subtle' : 'text-content-secondary';
    const ground = danger ? 'bg-danger-subtle' : 'bg-surface-sunken';

    const body = (
        <>
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
                {actionLabel === undefined ? null : (
                    <View testID={actionTestID} className="flex-row items-center gap-0.5">
                        <RNText className={`text-role-strong underline-offset-2 ${ink}`}>
                            {actionLabel}
                        </RNText>
                        <Icon name="chevronForward" size="sm" className={ink} />
                    </View>
                )}
            </View>
        </>
    );

    const frame = `min-h-[42px] flex-row items-center gap-2.5 px-[14px] py-1 ${ground}`;

    if (onPress === undefined) {
        return (
            <View testID={testID} className={frame}>
                {body}
            </View>
        );
    }
    return (
        <Pressable
            testID={testID}
            role="link"
            accessibilityRole="link"
            accessibilityLabel={
                accessibilityLabel ??
                [title, actionLabel].filter((part) => part !== undefined).join(', ')
            }
            onPress={onPress}
            className={`${frame} web:cursor-pointer web:transition-colors ${
                danger ? 'hover:bg-danger-border/30' : 'hover:bg-surface-brand-subtle'
            }`}
        >
            {body}
        </Pressable>
    );
}

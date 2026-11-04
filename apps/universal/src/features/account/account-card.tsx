import { Icon, cx } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

/**
 * The pieces every pane of the accepted Account board is built from: the white pane on a soft
 * shadow, its title row (the title, a count pill, whatever sits at its end), and the board's link
 * row. Written once here so the panes cannot drift apart.
 */

/** The board's pane: raised fill, soft hairline, 26px corners, a soft shadow. Padding is the caller's. */
export const ACCOUNT_CARD =
    'flex-col rounded-[26px] border border-stroke-subtle bg-surface-raised shadow-elevation-2';

/** The pane title — the board's 24px display face. */
export function PanelTitle({
    children,
    testID,
}: {
    readonly children: string;
    readonly testID?: string | undefined;
}) {
    return (
        <RNText
            testID={testID}
            accessibilityRole="header"
            aria-level={2}
            className="font-display text-2xl font-bold tracking-display text-content-primary text-start"
        >
            {children}
        </RNText>
    );
}

/** The board's title row: the title, a soft count pill, and anything at the end. */
export function PanelHead({
    title,
    count,
    end,
    testID,
}: {
    readonly title: string;
    readonly count?: string | undefined;
    readonly end?: ReactNode;
    readonly testID?: string | undefined;
}) {
    return (
        <View className="mb-[18px] flex-row flex-wrap items-center gap-3">
            <PanelTitle testID={testID}>{title}</PanelTitle>
            {count === undefined ? null : <CountPill label={count} />}
            {end === undefined ? null : (
                <View className="ms-auto flex-row flex-wrap gap-1.5">{end}</View>
            )}
        </View>
    );
}

export function CountPill({ label, testID }: { readonly label: string; readonly testID?: string }) {
    return (
        <View className="h-7 justify-center rounded-full bg-surface-brand-subtle px-2.5">
            <RNText
                testID={testID}
                className="text-xs font-semibold tabular-nums text-content-on-brand-subtle"
            >
                {label}
            </RNText>
        </View>
    );
}

/** The board's link row: an icon box, a label, a chevron — "Change password", "Close account". */
export function LinkRow({
    testID,
    icon,
    label,
    tone = 'neutral',
    onPress,
}: {
    readonly testID: string;
    readonly icon: 'lock' | 'smartphone' | 'infoCircle' | 'circleX';
    readonly label: string;
    readonly tone?: 'neutral' | 'danger';
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="link"
            accessibilityRole="link"
            onPress={onPress}
            className="h-14 flex-row items-center gap-3 border-t border-stroke-subtle px-1 hover:bg-surface-base"
        >
            <View
                className={cx(
                    'h-9 w-9 items-center justify-center rounded-xl',
                    tone === 'danger' ? 'bg-danger-subtle' : 'bg-surface-base',
                )}
            >
                <Icon
                    name={icon}
                    size="sm"
                    className={tone === 'danger' ? 'text-danger-on-subtle' : 'text-content-primary'}
                />
            </View>
            <RNText
                className={cx(
                    'flex-1 text-base text-start',
                    tone === 'danger' ? 'text-danger-on-subtle' : 'text-content-primary',
                )}
            >
                {label}
            </RNText>
            <Icon name="chevronForward" size="sm" className="text-content-secondary" />
        </Pressable>
    );
}

import { Card, Heading, Inline, Skeleton, Text, cx } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

/**
 * The overview boards' parts — the figures strip, the panels and their count boxes — drawn once for
 * the kitchen's overview (`screens/kitchen-home-screen.tsx`) and the corporate buyer's
 * (`business/screens/corporate-dashboard-screen.tsx`), which the corporate canvas draws in the same
 * look.
 */

export type Tone = 'warning' | 'ok' | 'neutral';

export const DOT_CLASS: Readonly<Record<Tone, string>> = {
    warning: 'bg-warning-border',
    ok: 'bg-surface-brand',
    neutral: 'bg-stroke-strong',
};

export const COUNT_CLASS: Readonly<Record<Tone, { readonly box: string; readonly ink: string }>> = {
    warning: { box: 'bg-warning-subtle', ink: 'text-warning-on-subtle' },
    ok: { box: 'bg-surface-brand-subtle', ink: 'text-content-on-brand-subtle' },
    neutral: { box: 'bg-surface-sunken', ink: 'text-content-secondary' },
};

/** A small count box — amber when it is waiting on someone. */
export function CountPill({
    value,
    tone,
    testID,
}: {
    readonly value: string;
    readonly tone: Tone;
    readonly testID?: string | undefined;
}) {
    return (
        <View
            testID={testID}
            className={cx(
                'h-6 items-center justify-center rounded-full px-2',
                COUNT_CLASS[tone].box,
            )}
            style={{ minWidth: 26 }}
        >
            <Text variant="label" className={cx('font-bold', COUNT_CLASS[tone].ink)}>
                {value}
            </Text>
        </View>
    );
}

/** One figure: a status dot, the label and the number, on one line at one size. */
export function StatTile({
    testID,
    label,
    value,
    pending,
    tone,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: string;
    readonly pending: boolean;
    readonly tone: Tone;
    readonly onPress?: (() => void) | undefined;
}) {
    return (
        <View style={{ flexGrow: 1, flexBasis: 0, minWidth: 150 }}>
            <Card
                testID={testID}
                padding="sm"
                tone="raised"
                interactive={onPress !== undefined}
                accessibilityLabel={label}
                {...(onPress === undefined ? {} : { onPress })}
                className={
                    tone === 'warning'
                        ? '!border-transparent !bg-warning-subtle'
                        : 'border-stroke-subtle'
                }
            >
                <Inline space="xs" align="center" wrap={false}>
                    <View className={cx('h-2 w-2 rounded-full', DOT_CLASS[tone])} />
                    <Text
                        tone={tone === 'warning' ? 'warning' : 'secondary'}
                        numberOfLines={1}
                        className="min-w-0 flex-1"
                    >
                        {label}
                    </Text>
                    {pending ? (
                        <Skeleton
                            testID={`${testID}-loading`}
                            heightClassName="h-5"
                            widthClassName="w-8"
                        />
                    ) : (
                        <Text
                            testID={`${testID}-value`}
                            variant="bodyStrong"
                            tone={tone === 'warning' ? 'warning' : 'primary'}
                            className="tabular-nums"
                        >
                            {value}
                        </Text>
                    )}
                </Inline>
            </Card>
        </View>
    );
}

/** A panel: a title, what sits beside it, then its lines. */
export function Panel({
    testID,
    title,
    count,
    link,
    grow = false,
    children,
}: {
    readonly testID: string;
    readonly title: string;
    readonly count?: ReactNode;
    readonly link?: { readonly label: string; readonly onPress: () => void } | undefined;
    /** The last card of a column: takes what is left, so the two columns end level. */
    readonly grow?: boolean | undefined;
    readonly children: ReactNode;
}) {
    return (
        <Card
            testID={testID}
            padding="none"
            tone="raised"
            className={cx('min-w-0 border-stroke-subtle p-1.5', grow ? 'flex-1' : '')}
        >
            <Inline space="sm" align="center" wrap={false} className="px-3 pb-2 pt-3">
                <Heading level={2}>{title}</Heading>
                {count}
                {link === undefined ? null : (
                    <Pressable
                        role="link"
                        onPress={link.onPress}
                        className="ms-auto min-h-6 justify-center"
                    >
                        <Text variant="label" tone="brand">
                            {link.label}
                        </Text>
                    </Pressable>
                )}
            </Inline>
            {children}
        </Card>
    );
}

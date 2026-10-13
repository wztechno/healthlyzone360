import { cx } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

/**
 * A titled card of label/value rows — what a subscription is, set out to be read and changed.
 *
 * The setup's review step and the subscription page both say the same kind of thing ("Plan:
 * Standard · 3 meals", "Address: Home · …"), so they draw it the same way: a raised card, a title
 * with at most one action beside it, and a two-column run of rows that stacks on a phone. A row
 * may carry its own action when only that one fact can be changed from here.
 *
 * Text is `self-start` throughout: a Latin value inside an Arabic page is an LTR run, and the web's
 * `text-align: start` resolves against the run rather than the page.
 */
export interface SummaryCardAction {
    readonly label: string;
    readonly onPress: () => void;
    readonly accessibilityLabel?: string | undefined;
    readonly testID?: string | undefined;
}

export interface SummaryCardRow {
    readonly key: string;
    readonly label: string;
    readonly value: string;
    readonly action?: SummaryCardAction | undefined;
    readonly testID?: string | undefined;
}

export interface SummaryCardProps {
    readonly title: string;
    readonly action?: SummaryCardAction | undefined;
    readonly rows?: readonly SummaryCardRow[] | undefined;
    /** Anything that is not a row — a price table, a list. Drawn under the rows. */
    readonly children?: ReactNode | undefined;
    readonly testID?: string | undefined;
}

/** The card's shell, for content that is not label/value rows. */
export function CardPanel({
    children,
    className,
    testID,
}: {
    readonly children: ReactNode;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}) {
    return (
        <View
            testID={testID}
            className={cx(
                'flex-col gap-4 rounded-panel border border-stroke bg-surface-raised p-5',
                className,
            )}
        >
            {children}
        </View>
    );
}

function ActionLink({ action }: { readonly action: SummaryCardAction }) {
    return (
        <Pressable
            testID={action.testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel ?? action.label}
            onPress={action.onPress}
            className="min-h-touch justify-center"
        >
            <RNText className="text-sm font-semibold text-content-on-brand-subtle hover:underline">
                {action.label}
            </RNText>
        </Pressable>
    );
}

export function SummaryCard({ title, action, rows = [], children, testID }: SummaryCardProps) {
    return (
        <CardPanel testID={testID}>
            <View className="-my-2 min-h-touch flex-row items-center justify-between gap-3">
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="self-center text-base font-semibold text-content-primary text-start"
                >
                    {title}
                </RNText>
                {action === undefined ? null : <ActionLink action={action} />}
            </View>

            {rows.length === 0 ? null : (
                <View className="flex-col">
                    {rows.map((row, index) => (
                        <View
                            key={row.key}
                            testID={row.testID}
                            className={cx(
                                'flex-row items-start gap-3 py-2.5',
                                index === 0 ? null : 'border-t border-stroke-subtle',
                            )}
                        >
                            <View className="min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:gap-4">
                                <RNText className="self-start text-sm text-content-secondary text-start md:w-[140px] md:pt-0.5">
                                    {row.label}
                                </RNText>
                                <RNText className="min-w-0 shrink self-start text-base text-content-primary text-start">
                                    {row.value}
                                </RNText>
                            </View>
                            {row.action === undefined ? null : (
                                <View className="-my-2.5">
                                    <ActionLink action={row.action} />
                                </View>
                            )}
                        </View>
                    ))}
                </View>
            )}

            {children}
        </CardPanel>
    );
}

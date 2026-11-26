import { Badge, ShellDock, Text, cx } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The parts a stepped posting form is drawn from besides its step track (the design system's `Tabs variant="pills"`):
 * the card one step lives in, the boxes its last step reviews in, and the bar Post sits on. The
 * Procurement boards of 2026-11-24 — Receive a delivery and Post a goods receipt.
 */

export interface StepCardProps {
    /** Translated. */
    readonly title: string;
    /** A figure beside the title — "4 to post, 1 left out" — on the brand's subtle pill. */
    readonly count?: string | undefined;
    /** Drawn at the end of the title row: a search, the scan field, a toggle. */
    readonly actions?: ReactNode | undefined;
    readonly children: ReactNode;
    readonly testID: string;
}

/** One step's card: a raised panel with a display-face title row. */
export function StepCard({ title, count, actions, children, testID }: StepCardProps) {
    return (
        <View
            testID={testID}
            className="mt-3 rounded-[22px] border border-stroke-subtle bg-surface-raised px-[22px] pb-[22px] pt-5"
        >
            <View className="mb-3 min-h-[34px] flex-row flex-wrap items-center gap-2.5">
                <Text
                    role="heading"
                    aria-level={2}
                    className="font-display !text-[18px] !leading-6 font-bold tracking-[-0.01em] text-content-primary"
                >
                    {title}
                </Text>
                {count === undefined ? null : (
                    <Badge testID={`${testID}-count`} tone="brand" label={count} />
                )}
                {actions === undefined ? null : (
                    <View className="ms-auto flex-row flex-wrap items-center gap-2">{actions}</View>
                )}
            </View>
            {children}
        </View>
    );
}

/** A titled box on the review step — "This delivery", "To fix". */
export function ReviewBox({
    title,
    trailing,
    children,
    testID,
}: {
    readonly title: string;
    readonly trailing?: ReactNode | undefined;
    readonly children: ReactNode;
    readonly testID: string;
}) {
    return (
        <View
            testID={testID}
            className="rounded-[18px] border border-stroke-subtle bg-surface-raised px-4 pb-4 pt-3.5"
        >
            <View className="mb-2.5 flex-row items-center gap-2">
                <Text
                    role="heading"
                    aria-level={3}
                    className="!text-sm font-bold text-content-primary"
                >
                    {title}
                </Text>
                {trailing}
            </View>
            {children}
        </View>
    );
}

export interface PostBarProps {
    /** What the form will post, in a line — "4 to post, 1 left out". */
    readonly summary: string;
    /** Between the summary and the action — a receipt's total. Pushed to the end. */
    readonly figure?: ReactNode | undefined;
    /** The commit, on the last step only. */
    readonly action?: ReactNode | undefined;
    readonly testID: string;
}

/**
 * The bar the form's commit sits on, docked to the shell's bottom edge so nothing scrolls under it.
 * Drawn as a floating card inset from the edge, the way the boards draw it.
 */
export function PostBar({ summary, figure, action, testID }: PostBarProps) {
    return (
        <ShellDock>
            <View className="px-3 pb-3 pt-1">
                <View
                    testID={testID}
                    className={cx(
                        'min-h-[44px] flex-row flex-wrap items-center gap-3.5 rounded-[22px] border border-stroke bg-surface-raised py-2.5 pe-2.5 ps-[18px] shadow-elevation-card',
                    )}
                >
                    <Text
                        testID={`${testID}-summary`}
                        numberOfLines={1}
                        className="text-[13px] font-semibold tabular-nums text-content-secondary"
                    >
                        {summary}
                    </Text>
                    {figure === undefined ? (
                        <View className="flex-1" />
                    ) : (
                        <View className="ms-auto flex-row items-baseline gap-1.5">{figure}</View>
                    )}
                    {action}
                </View>
            </View>
        </ShellDock>
    );
}

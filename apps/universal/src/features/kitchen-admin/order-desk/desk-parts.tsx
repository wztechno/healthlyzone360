import { Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The small pieces every order desk screen draws the same way.
 *
 * They live here rather than in the design system on the Catalogue's promotion rule: a component
 * reaches `@healthy360/design-system` when two entities use it, and these are one surface's
 * vocabulary — the desk's labelled facts, its section rules and its footnotes. The five screens
 * share them so a drawer, a review step and a report read as one desk rather than five.
 */

/** How wide a fact's label column is. A style, not a class: there is no 118px width token. */
const FACT_LABEL_WIDTH = 118;

/**
 * One labelled fact on a hairline: `Paying by   Cash on delivery`.
 *
 * Pairs, never a table — a drawer's customer block is two or three facts about one record, and a
 * table there would announce rows and columns a screen reader then has to walk. The label column is
 * fixed so the values down a section share one leading edge, which is what makes a block of facts
 * scannable without a rule between the two halves.
 */
export function DeskFact({
    label,
    value,
    mono = false,
    testID,
}: {
    readonly label: string;
    readonly value: string;
    /** Times, money, quantities and references take the numeric role. */
    readonly mono?: boolean | undefined;
    readonly testID?: string | undefined;
}) {
    return (
        <View className="flex-row items-baseline gap-snug border-b border-stroke-subtle py-tight">
            <View style={{ width: FACT_LABEL_WIDTH }}>
                <Text variant="caption" tone="secondary">
                    {label}
                </Text>
            </View>
            {/* eslint-disable-next-line no-restricted-syntax -- the value column is the row's filler. */}
            <View className="min-w-0 flex-1">
                <Text variant={mono ? 'mono' : 'label'} testID={testID}>
                    {value}
                </Text>
            </View>
        </View>
    );
}

/**
 * A section's opening inside a drawer or a step: a small heading on a hairline, with the one control
 * that belongs to the section at its inline end.
 *
 * `FormSection` draws the same rule for a form, but it carries a description slot and a field grid's
 * spacing that a three-fact block has no use for. This is the drawer-sized version.
 */
export function DeskSectionHeading({
    title,
    action,
    strong = false,
    testID,
}: {
    readonly title: string;
    readonly action?: ReactNode | undefined;
    /** Set the title at the choice-card label size rather than the column-label step. */
    readonly strong?: boolean | undefined;
    readonly testID?: string | undefined;
}) {
    return (
        <View className="min-h-control-sm flex-row items-center justify-between gap-tight border-b border-stroke-subtle pb-hair">
            <Text
                variant={strong ? 'strong' : 'micro'}
                tone={strong ? 'primary' : 'secondary'}
                accessibilityRole="header"
                testID={testID}
            >
                {title}
            </Text>
            {action}
        </View>
    );
}

/**
 * One line of a money summary: `Subtotal ........ AED 42.00`.
 *
 * `emphasis` is the total line — the one figure a desk agent reads aloud — which takes the display
 * step and a rule above it. Everything else is a caption, so the eye lands on the total first.
 */
export function DeskAmount({
    label,
    value,
    emphasis = false,
    testID,
}: {
    readonly label: string;
    readonly value: string;
    readonly emphasis?: boolean | undefined;
    readonly testID?: string | undefined;
}) {
    return (
        <View
            className={
                emphasis
                    ? 'flex-row items-baseline justify-between gap-tight border-t border-stroke-subtle pt-tight'
                    : 'flex-row items-baseline justify-between gap-tight'
            }
        >
            <Text
                variant={emphasis ? 'strong' : 'caption'}
                tone={emphasis ? 'primary' : 'secondary'}
            >
                {label}
            </Text>
            <Text
                variant={emphasis ? 'display' : 'mono'}
                tone={emphasis ? 'brand' : 'secondary'}
                className="tabular-nums"
                testID={testID}
            >
                {value}
            </Text>
        </View>
    );
}

/**
 * A line of standing explanation under a list — what the figures mean, or why the list is shaped
 * the way it is. Caption size and secondary ink, so it is there for somebody who looks and invisible
 * to somebody working.
 */
export function DeskFootnote({
    children,
    testID,
}: {
    readonly children: string;
    readonly testID?: string | undefined;
}) {
    return (
        <Text variant="caption" tone="secondary" testID={testID}>
            {children}
        </Text>
    );
}

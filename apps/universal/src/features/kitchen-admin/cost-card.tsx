import { Card, Text } from '@healthy360/design-system';
import type { CardTone } from '@healthy360/design-system';
import { View } from 'react-native';

/** One row of a {@link CostCard} — a label, the figure it names, and whether it is the conclusion. */
export interface CostCardRow {
    readonly label: string;
    /** Empty where the label is the whole statement — a cost withheld, with its reason. */
    readonly value: string;
    readonly lead: boolean;
}

/**
 * One cost tile: a `micro` title over a short ledger.
 *
 * Shared by the recipe editor's Costing tab and the Packs & prices tab's "Cost per pack", so the two
 * are the same object rather than two drawings of it — two copies of a card is two chances for one
 * of them to keep the old row rhythm after the other is adjusted.
 */
export function CostCard({
    title,
    tone,
    rows,
    testID,
}: {
    readonly title: string;
    readonly tone: CardTone;
    readonly rows: readonly CostCardRow[];
    readonly testID: string;
}) {
    return (
        <Card testID={testID} padding="sm" tone={tone}>
            <View className="flex-col gap-hair">
                <Text variant="micro" tone="secondary" numberOfLines={1}>
                    {title}
                </Text>
                {rows.map((row) => (
                    <View
                        key={row.label}
                        className="flex-row items-baseline justify-between gap-tight"
                    >
                        <Text variant="caption" tone="secondary" numberOfLines={1}>
                            {row.label}
                        </Text>
                        {/*
                         * The last row of each card is the one the card is for, so it takes the
                         * strong step; the ones above it are the working.
                         */}
                        <Text variant={row.lead ? 'bodyStrong' : 'mono'} numberOfLines={1}>
                            {row.value}
                        </Text>
                    </View>
                ))}
            </View>
        </Card>
    );
}

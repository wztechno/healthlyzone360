import { FormSection, Text } from '@healthy360/design-system';
import type { TextTone } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/** One fact in the aside's head: a label at the start, its value at the end. */
export interface RecordSummaryRow {
    readonly key: string;
    readonly label: string;
    readonly value: string;
}

/** One line of what the record will do — an item and its effect. */
export interface RecordSummaryListItem {
    readonly key: string;
    readonly name: string;
    readonly value: string;
    /** `success` for what rises, `secondary` for a plain count. */
    readonly tone?: TextTone | undefined;
    readonly testID?: string | undefined;
}

export interface RecordSummaryAsideProps {
    /**
     * The aside's root. The card is `${testID}-card`, each head row `${testID}-${row.key}` and the
     * total `${testID}-total`; the list carries its own ids because it is the part tests read.
     */
    readonly testID: string;
    readonly title: string;
    readonly rows: readonly RecordSummaryRow[];
    /** The record's bottom line, or `null` when there is none to show this reader. */
    readonly total: { readonly label: string; readonly value: string } | null;
    readonly list?: {
        readonly title: string;
        readonly empty: string;
        readonly items: readonly RecordSummaryListItem[];
        readonly testID: string;
        readonly emptyTestID: string;
    };
    /** A callout under the list — what still needs saying before the commit. */
    readonly note?: ReactNode;
}

/**
 * The record form's aside: the record in a few facts and what committing it will do.
 *
 * Drawn first for Post receipt and shared with the supply-order builder and the supply order page,
 * which ask the same thing of their reader — *this is what you are about to create, this is its
 * effect*. The commit itself is not here: it sits in the page's opening, and a second copy at the
 * aside's foot was one button drawn twice.
 *
 * ```
 * ┌ THIS RECEIPT ────────────┐
 * │ Kind      Market purchase │
 * │ Supplier  Beqaa Fresh     │
 * │ Total        318.30 USD   │
 * │ ───────────────────────── │
 * │ Stock at Beirut rises by  │
 * │ Chicken breast   +24 kg   │
 * │ ⚠ 1 line has no price…    │
 * └───────────────────────────┘
 * ```
 *
 * One card rather than three, its parts divided by hairlines, because it is read top to bottom as
 * one statement. It sizes nothing itself: a `SideRailLayout` rail owns the width, the sticky
 * offset and the alignment, so the card is the same card beside a form and stacked under one.
 */
export function RecordSummaryAside({
    testID,
    title,
    rows,
    total,
    list,
    note,
}: RecordSummaryAsideProps) {
    return (
        <View testID={testID} role="complementary" aria-label={title} className="z-auto">
            <FormSection first variant="card" testID={`${testID}-card`} title={title}>
                <View className="flex-col gap-base">
                    <View className="flex-col gap-snug">
                        {rows.map((row) => (
                            <View
                                key={row.key}
                                testID={`${testID}-${row.key}`}
                                className="flex-row items-baseline justify-between gap-tight"
                            >
                                <Text variant="caption" tone="secondary" numberOfLines={1}>
                                    {row.label}
                                </Text>
                                <Text
                                    variant="caption"
                                    align="end"
                                    numberOfLines={1}
                                    className="min-w-0 shrink font-medium tabular-nums"
                                >
                                    {row.value}
                                </Text>
                            </View>
                        ))}
                        {total === null ? null : (
                            <View className="mt-hair flex-row items-baseline justify-between gap-tight border-t border-stroke-subtle pt-tight">
                                <Text variant="label">{total.label}</Text>
                                <Text
                                    testID={`${testID}-total`}
                                    variant="title"
                                    className="tabular-nums"
                                >
                                    {total.value}
                                </Text>
                            </View>
                        )}
                    </View>

                    {list === undefined ? null : (
                        <View className="flex-col gap-snug border-t border-stroke-subtle pt-base">
                            <Text variant="strong">{list.title}</Text>
                            {list.items.length === 0 ? (
                                <Text variant="caption" tone="secondary" testID={list.emptyTestID}>
                                    {list.empty}
                                </Text>
                            ) : (
                                <View testID={list.testID} className="flex-col gap-hair">
                                    {list.items.map((item) => (
                                        <View
                                            key={item.key}
                                            testID={item.testID}
                                            className="flex-row items-baseline justify-between gap-tight"
                                        >
                                            <Text
                                                variant="caption"
                                                numberOfLines={1}
                                                className="min-w-0 shrink"
                                            >
                                                {item.name}
                                            </Text>
                                            <Text
                                                variant="caption"
                                                tone={item.tone ?? 'secondary'}
                                                className="font-semibold tabular-nums"
                                            >
                                                {item.value}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            )}
                        </View>
                    )}

                    {note}
                </View>
            </FormSection>
        </View>
    );
}

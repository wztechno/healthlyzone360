import { View } from 'react-native';
import { Text } from '../primitives/text.tsx';
import type { TextTone } from '../primitives/text.tsx';
/**
 * ListSummaryCards — the count strip under a list's title (Workbench handoff §3z).
 *
 * ```
 * ┌ SHOWN ─────────┐ ┌ BLOCKED ───────┐ ┌ TO FINISH ─────┐
 * │ 6  records     │ │ 2  records     │ │ 4  records     │
 * │ 3 families     │ │ publication …  │ │ not blocked …  │
 * └────────────────┘ └────────────────┘ └────────────────┘
 * ```
 *
 * Three rules, and this component exists to hold them:
 *
 * 1. **Every figure is counted over the rows in hand**, so a filter moves the cards, the pager and
 *    the list together. The component cannot enforce that, but its API has no
 *    slot for a backend total either, and the caller's docblock is where the counting is argued.
 * 2. **A tone colours the figure only when the figure is non-zero.** That one *is* enforced here:
 *    `count === 0` drops the tone, so `Blocked 0` can never come out red by a caller forgetting.
 *    The tone is ink on the numeral, never a fill — three amber cards read as an alert strip.
 * 3. **The page chip never restates a card.** A rule for the caller; noted so nobody adds a count
 *    to the chip "for emphasis".
 *
 * Compared with `CatalogueStatCards`: no corner mark, no pressable cards, a smaller figure. That
 * strip is a filter bar whose figures are destinations; this one only counts.
 */
export const SUMMARY_CARD_TONES = ['danger', 'warning', 'success', 'info', 'brand'] as const;
export type SummaryCardTone = (typeof SUMMARY_CARD_TONES)[number];
export interface SummaryCard {
    readonly key: string;
    /** Translated. The `micro` step. */
    readonly label: string;
    /** The figure, as counted. Read for the zero rule; `value` is what is drawn. */
    readonly count: number;
    /** `count`, formatted — the caller owns the numbering system. */
    readonly value: string;
    /** What the figure counts — "records", "of 7". */
    readonly unit?: string | undefined;
    /** One translated line under the figure. */
    readonly caption?: string | undefined;
    readonly tone?: SummaryCardTone | undefined;
}
export interface ListSummaryCardsProps {
    readonly cards: readonly SummaryCard[];
    readonly testID?: string | undefined;
}
/** The strip's cap — the design's `max-width: 920px`. There is no width token for it. */
const STRIP_MAX_WIDTH = 920;
/** Each card's floor, the design's `minmax(148px, 1fr)`. */
const CARD_MIN_WIDTH = 148;
export function ListSummaryCards({ cards, testID }: ListSummaryCardsProps) {
    return (
        <View
            testID={testID}
            style={{ maxWidth: STRIP_MAX_WIDTH }}
            className="flex-row flex-wrap gap-tight"
        >
            {cards.map((card) => {
                const tone: TextTone =
                    card.tone === undefined || card.count === 0 ? 'primary' : card.tone;
                const id = testID === undefined ? undefined : `${testID}-${card.key}`;
                return (
                    <View
                        key={card.key}
                        testID={id}
                        // `flex-1` with a floor is `auto-fit, minmax(148px, 1fr)` in a flex row: each
                        // card is one of the strip's columns, and a narrow port wraps them.
                        className="flex-1 flex-col gap-px rounded border border-stroke-subtle bg-surface-raised px-2.5 py-1.5"
                        style={{ minWidth: CARD_MIN_WIDTH }}
                    >
                        <Text variant="micro" tone="secondary" numberOfLines={1}>
                            {card.label}
                        </Text>
                        <View className="min-w-0 flex-row items-baseline gap-hair">
                            {/*
                             * `section` is the ramp's 13px/600 step; the design's 18px mono figure has
                             * no step of its own and CLAUDE.md forbids half-steps, so the figure
                             * carries weight and tabular numerals until the mono family lands.
                             */}
                            <Text
                                variant="section"
                                tone={tone}
                                className="tabular-nums"
                                testID={id === undefined ? undefined : `${id}-value`}
                            >
                                {card.value}
                            </Text>
                            {card.unit === undefined ? null : (
                                <Text variant="caption" tone="secondary" numberOfLines={1}>
                                    {card.unit}
                                </Text>
                            )}
                        </View>
                        {card.caption === undefined ? null : (
                            <Text variant="caption" tone="secondary" numberOfLines={1}>
                                {card.caption}
                            </Text>
                        )}
                    </View>
                );
            })}
        </View>
    );
}

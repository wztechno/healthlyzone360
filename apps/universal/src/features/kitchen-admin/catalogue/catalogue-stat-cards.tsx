import { Card, Icon, Text } from '@healthy360/design-system';
import type { CardTone, IconName, TextTone } from '@healthy360/design-system';
import { cardWidth } from '@healthy360/design-tokens';
import { View } from 'react-native';

/**
 * Part three of a Catalogue list page, as cards.
 *
 * ```
 * ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
 * │ SHOWN         ▤  │ │ DRAFT         ◌  │ │ MISSING AR    ⚠  │ │ UNCOSTED      ⚠  │
 * │ 18  of 18        │ │ 2  records       │ │ 3  records       │ │ 2  records       │
 * │ No filters       │ │ not published    │ │ blocks publishing│ │ no unit price    │
 * └──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘
 * ```
 *
 * These are the same four figures {@link CatalogueSummaryBar} states as one 11px line, and the two
 * are alternatives rather than companions: a page draws one or the other. This screen draws the
 * cards, so the line is gone — stating "2 draft" twice, sixteen pixels apart, is not orientation,
 * it is noise.
 *
 * ## A card is worth the vertical space only when the figure is a destination
 *
 * The cards are not a dashboard. Two of the four are filters — Shown clears every constraint,
 * Draft narrows to the drafts — so pressing the number does the thing the number is telling you
 * about, and those two are the reason the row earns roughly 70px of fold that a caption line would
 * not. The other two are read-only because there is no filter behind them: `IngredientAdminFilter`
 * carries no "missing Arabic" and no "uncosted" parameter, and a card that looked pressable and
 * then did nothing would be worse than a card that does not.
 *
 * That is also why `onPress` is per-card rather than assumed. `Card`'s own docblock makes the same
 * argument from the other side: `interactive` is opt-in because a card with controls inside it puts
 * its affordance on the control instead.
 *
 * ## Tone is ink first and fill second
 *
 * Three of the four cards keep the ordinary raised fill and change only the value's ink; Draft
 * takes the amber fill as well, and only while there is something to act on. A row of four
 * coloured panels reads as an alert state, so the fill is spent once, on the one figure a person is
 * expected to clear before the end of the day.
 *
 * Colour is never alone: every card carries a mark, and the caption says in words what the tone
 * says in ink.
 */

export interface CatalogueStatCard {
    readonly key: string;
    /** Translated. Rendered on the `micro` step — 10px. */
    readonly label: string;
    /** The figure. Already formatted, because the caller owns the numbering system. */
    readonly value: string;
    /** What the figure counts — "records", "of 248". Sits on the value's baseline. */
    readonly unit?: string | undefined;
    /** One translated line under the figure, saying what the tone means. */
    readonly caption: string;
    /** The corner mark. Decorative — the label and caption carry the meaning. */
    readonly mark: IconName;
    readonly tone?: CatalogueStatTone | undefined;
    /** Makes the card a filter. Omit for a figure with no filter behind it. */
    readonly onPress?: (() => void) | undefined;
    /** Required with `onPress`: the label names the figure, not the action. */
    readonly accessibilityLabel?: string | undefined;
}

export const CATALOGUE_STAT_TONES = ['default', 'brand', 'warning', 'danger'] as const;
export type CatalogueStatTone = (typeof CATALOGUE_STAT_TONES)[number];

/** Ink for the figure. The tone's whole job, on three of the four cards. */
const VALUE_TONE: Readonly<Record<CatalogueStatTone, TextTone>> = {
    default: 'primary',
    brand: 'brand',
    warning: 'warning',
    danger: 'danger',
};

/** Ink for the caption — it follows the figure, so the pair never disagrees. */
const CAPTION_TONE: Readonly<Record<CatalogueStatTone, TextTone>> = {
    default: 'secondary',
    brand: 'secondary',
    warning: 'warning',
    danger: 'danger',
};

/**
 * Fill. Only `warning` takes one — see the note above on spending the fill once.
 *
 * `raised` rather than `default`: in the compact ladder `raised` is the white card on the page's
 * off-white ground and casts no shadow, which is the flat elevation §1.3 allows.
 */
/**
 * Ink for the corner mark.
 *
 * `className`, not a `tone` prop: an icon here is a typographic glyph on React Native's own `Text`,
 * so it has no tone of its own and takes the ink token directly — the pattern every other call
 * site in the app uses. The classes are `Text`'s own `TONE_CLASS` entries, so a mark can never
 * disagree with the figure beneath it.
 */
const MARK_CLASS: Readonly<Record<CatalogueStatTone, string>> = {
    default: 'text-content-disabled',
    brand: 'text-content-on-brand-subtle',
    warning: 'text-warning-strong',
    danger: 'text-danger-strong',
};

const CARD_TONE: Readonly<Record<CatalogueStatTone, CardTone>> = {
    default: 'raised',
    brand: 'raised',
    warning: 'warning',
    danger: 'raised',
};

export interface CatalogueStatCardsProps {
    readonly cards: readonly CatalogueStatCard[];
    readonly testID: string;
}

export function CatalogueStatCards({ cards, testID }: CatalogueStatCardsProps) {
    return (
        /*
         * The cards fill the row, with a gap between them.
         *
         * This has now been three shapes. Fixed 200px cards packed at the leading edge left ~380px
         * of nothing after the fourth; centring moved that to the two outer margins; `between` put
         * it in the gaps, which fills the row but leaves the four cards floating a long way apart
         * with no relationship to each other. What the row actually wants is for the cards to be
         * *bigger*: the space belongs inside them, where the figure and its caption are, rather
         * than around them.
         *
         * So each card takes an equal share of the row — `flex-1` on its cell, floored at
         * `cardWidth.min` so a narrow port wraps instead of crushing four cards into 90px each —
         * and `gap-snug` (12px) keeps them apart. That is the "little space" and no more: the cards
         * are one row of related figures, and a gap wide enough to read as a separator would say
         * they are four unrelated panels.
         */
        <View testID={testID} className="flex-row flex-wrap items-stretch gap-snug">
            {cards.map((card) => (
                /*
                 * A wrapping row of equal shares, not `CardGrid`.
                 *
                 * `CardGrid`'s track is `minmax(200px, 260px)` and caps at the max, so on a 1230px
                 * row it would draw four 260px cards and leave the remainder over — the problem
                 * this row is trying to stop having. `flex-1` has no cap: the cards take whatever
                 * the row is, which is the point.
                 *
                 * `minWidth` rather than a fixed `width` is what keeps the wrap honest. A flex
                 * child will shrink below its content without one, so four cards on a phone would
                 * become four unreadable slivers instead of wrapping to two lines of two.
                 *
                 * The `View` around each card is also load-bearing. A `Card` with `onPress`
                 * renders a real `<button>`, whose `width: auto` is shrink-to-fit rather than
                 * fill — dropped straight into a sized cell the two *filter* cards came out 108px
                 * and 118px wide while the two read-only ones filled theirs, so one row of four
                 * identical figures rendered as four different boxes. A `View` is a flex column,
                 * so its child stretches on the cross axis; it is the same mechanism
                 * `CardGridItem` already uses on the customer surfaces, which is why their
                 * pressable cards never showed this. Fixed here rather than in `Card`: a blanket
                 * `w-full` on the pressable branch would also stretch every card sitting in a flex
                 * row, which is a different layout with a different right answer.
                 *
                 * `flex-1` trips the no-stretch fence, and this is the exemption that fence
                 * names by example: the `View` is not a control taking its width from a
                 * container, it *is* one of the row's four columns — the same case as the
                 * toolbar's spacer and a list row's title column. The card inside it is still
                 * sized by the token, and `minWidth` is what makes a narrow port wrap rather
                 * than shrink four cards into slivers.
                 */
                <View
                    key={card.key}
                    // eslint-disable-next-line no-restricted-syntax -- the cell *is* the row's column; see above.
                    className="flex-1 flex-col"
                    style={{ minWidth: cardWidth.min }}
                >
                    <StatCard card={card} testID={`${testID}-${card.key}`} />
                </View>
            ))}
        </View>
    );
}

function StatCard({ card, testID }: { readonly card: CatalogueStatCard; readonly testID: string }) {
    const tone = card.tone ?? 'default';

    return (
        <Card
            tone={CARD_TONE[tone]}
            padding="sm"
            interactive={card.onPress !== undefined}
            onPress={card.onPress}
            accessibilityLabel={card.accessibilityLabel}
            testID={testID}
        >
            {/*
             * One child, so `Card`'s own 8px gap between children never applies: these three lines
             * are a single block at 4px, which is what makes the card 70px rather than 96px.
             */}
            <View className="flex-col gap-hair">
                <View className="flex-row items-baseline justify-between gap-tight">
                    <Text variant="micro" tone="secondary" numberOfLines={1}>
                        {card.label}
                    </Text>
                    <Icon name={card.mark} size="sm" className={MARK_CLASS[tone]} />
                </View>

                <View className="flex-row items-baseline gap-hair">
                    {/*
                     * `display` (20/26, 700), not the `mono` role. The design sets these figures
                     * in IBM Plex Mono, and CLAUDE.md's sequencing decision defers that family
                     * to the palette pass — "carry numerics with weight and alignment for now" —
                     * so the figure takes the ramp's one large step and nothing else.
                     */}
                    <Text variant="display" tone={VALUE_TONE[tone]} testID={`${testID}-value`}>
                        {card.value}
                    </Text>
                    {card.unit === undefined ? null : (
                        <Text variant="caption" tone="secondary">
                            {card.unit}
                        </Text>
                    )}
                </View>

                <Text variant="caption" tone={CAPTION_TONE[tone]} numberOfLines={2}>
                    {card.caption}
                </Text>
            </View>
        </Card>
    );
}

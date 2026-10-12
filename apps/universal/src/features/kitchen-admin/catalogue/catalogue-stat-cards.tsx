import { Card, FadeIn, Icon, Skeleton, Text, useContentWidth } from '@healthy360/design-system';
import type { CardTone, IconName, TextTone } from '@healthy360/design-system';
import { cardWidth } from '@healthy360/design-tokens';
import { View } from 'react-native';

/**
 * Part three of a Catalogue list page, as cards. (The marks in the sketch are the native glyphs; the
 * web draws Lucide's `list`, `file-pen-line`, `languages` and `coins` in their place.)
 *
 * ```
 * ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
 * │ SHOWN         ▤  │ │ DRAFT         ◌  │ │ MISSING AR    ⚠  │ │ UNCOSTED      ⚠  │
 * │ 18  of 18        │ │ 2  records       │ │ 3  records       │ │ 2  records       │
 * │ No filters       │ │ not published    │ │ blocks publishing│ │ no unit price    │
 * └──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘
 * ```
 *
 * There was a one-line variant of these same four figures for a while. Nothing ever rendered it —
 * a page that drew both would state "2 draft" twice, sixteen pixels apart, which is not
 * orientation — so the cards are the only form now.
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
    /** Translated. Rendered on the `title` step — 16px at 600. */
    readonly label: string;
    /** The figure. Already formatted, because the caller owns the numbering system. */
    readonly value: string;
    /** What the figure counts — "records", "of 248". Sits on the value's baseline. */
    readonly unit?: string | undefined;
    /**
     * One translated line under the figure. Optional: a strip whose labels already say it all (the
     * kitchen overview) leaves it out rather than repeating the label in other words.
     */
    readonly caption?: string | undefined;
    /** The corner mark. Decorative — the label and caption carry the meaning. */
    readonly mark: IconName;
    readonly tone?: CatalogueStatTone | undefined;
    /**
     * This card's figure alone is still in flight. Overrides the strip's `pending` for one card, for
     * a strip whose figures come from different reads and land at different times.
     */
    readonly pending?: boolean | undefined;
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
 * Ink for the corner mark.
 *
 * `className`, not a `tone` prop: an icon here is a Lucide drawing on the web and a typographic
 * glyph on native, and neither has a tone of its own — both take the ink token directly (the SVG
 * through `currentColor`), the pattern every other call site in the app uses. The classes are `Text`'s own `TONE_CLASS` entries, so a mark can never
 * disagree with the figure beneath it.
 */
const MARK_CLASS: Readonly<Record<CatalogueStatTone, string>> = {
    default: 'text-content-disabled',
    brand: 'text-content-on-brand-subtle',
    warning: 'text-warning-strong',
    danger: 'text-danger-strong',
};

/**
 * Fill. Only `warning` takes one — see the note above on spending the fill once.
 *
 * `raised` rather than `default`: in the compact ladder `raised` is the white card on the page's
 * off-white ground with the card cast, where `default` is the ground itself and stays flat.
 */
const CARD_TONE: Readonly<Record<CatalogueStatTone, CardTone>> = {
    default: 'raised',
    brand: 'raised',
    warning: 'warning',
    danger: 'raised',
};

/** A space the layout cannot collapse, so an otherwise empty line still takes its full height. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

export interface CatalogueStatCardsProps {
    readonly cards: readonly CatalogueStatCard[];
    /**
     * The figures are still in flight.
     *
     * Each card is drawn anyway — frame, label, mark and caption, none of which wait on the data —
     * with a placeholder holding the figure's line. The row is its loaded height from the first
     * frame, so when the figures land the toolbar and table below do not move. A screen that drew
     * nothing here until its list resolved pushed both down by a card's height at that moment,
     * which is the jump a reader sees as the page arriving twice.
     *
     * Passing it at all is also what animates the arrival: a caller that has a pending state gets
     * its figures faded in when they land, and one that does not draws them as they are.
     */
    readonly pending?: boolean | undefined;
    /**
     * The counts behind every card but the first are still in flight.
     *
     * The first card is the page's own "18 of 306", which the page query answers. The rest count
     * every page the filters match, which a second, longer read answers — until it lands they hold
     * a placeholder rather than a zero that reads as "none".
     */
    readonly countsPending?: boolean | undefined;
    readonly testID: string;
}

export function CatalogueStatCards({
    cards,
    pending,
    countsPending,
    testID,
}: CatalogueStatCardsProps) {
    const { width: contentWidth } = useContentWidth();
    const rows = statCardRows(cards.length, contentWidth);
    // `null` is a spacer: a short last row keeps the columns above it rather than stretching.
    const grid: (CatalogueStatCard | null)[][] = [];
    for (let start = 0; start < cards.length; start += rows.perRow) {
        const row: (CatalogueStatCard | null)[] = cards.slice(start, start + rows.perRow);
        while (row.length < rows.perRow) row.push(null);
        grid.push(row);
    }

    return (
        /*
         * The cards fill the row, with a gap between them.
         *
         * This has now been four shapes. Fixed 200px cards packed at the leading edge left ~380px
         * of nothing after the fourth; centring moved that to the two outer margins; `between` put
         * it in the gaps, which fills the row but leaves the four cards floating a long way apart
         * with no relationship to each other. What the row actually wants is for the cards to be
         * *bigger*: the space belongs inside them, where the figure and its caption are, rather
         * than around them. So each card takes an equal share of its row, and `gap-snug` (12px)
         * keeps them apart — the cards are one set of related figures, and a gap wide enough to
         * read as a separator would say they are unrelated panels.
         *
         * The fourth shape is how a narrow page breaks the set. A free wrap at `cardWidth.min` put
         * whatever no longer fitted on a line of its own — four became 3 + 1, the home's five 4 + 1
         * — and the one card on the second line stretched across the whole page, reading as the
         * important figure rather than the leftover one. So the rows are counted first
         * (`statCardRows`) and balanced: four go 2 + 2, five go 3 + 2, and a short last row keeps
         * its columns with spacers rather than stretching. Counted from the content column, not
         * the window — on a laptop the window says "wide" while the page is ~920px.
         */
        <View testID={testID} className="flex-col gap-snug">
            {grid.map((row, rowIndex) => (
                <View key={String(rowIndex)} className="flex-row items-stretch gap-snug">
                    {row.map((card, column) => {
                        const index = rowIndex * rows.perRow + column;
                        return (
                            /*
                             * The `View` around each card is load-bearing. A `Card` with `onPress`
                             * renders a real `<button>`, whose `width: auto` is shrink-to-fit
                             * rather than fill — dropped straight into a sized cell the two
                             * *filter* cards came out 108px and 118px wide while the two read-only
                             * ones filled theirs. A `View` is a flex column, so its child stretches
                             * on the cross axis; it is the same mechanism `CardGridItem` uses on the
                             * customer surfaces.
                             *
                             * `flex-1` trips the no-stretch fence, and this is the exemption that
                             * fence names by example: the `View` is not a control taking its width
                             * from a container, it *is* one of the row's columns.
                             */
                            <View
                                key={card?.key ?? `spacer-${String(column)}`}
                                // eslint-disable-next-line no-restricted-syntax -- the cell *is* the row's column; see above.
                                className="flex-1 flex-col"
                                aria-hidden={card === null ? true : undefined}
                            >
                                {card === null ? null : (
                                    <StatCard
                                        card={card}
                                        pending={
                                            card.pending ??
                                            (index > 0 && countsPending === true ? true : pending)
                                        }
                                        testID={`${testID}-${card.key}`}
                                    />
                                )}
                            </View>
                        );
                    })}
                </View>
            ))}
        </View>
    );
}

/**
 * How many cards a row, for `count` cards on a page `width` wide.
 *
 * As many as keep `cardWidth.min` each; if that is not all of them, the rows are balanced — the
 * fewest rows that hold the set, then the fewest cards a row that fills them — so the last row is
 * never one card on its own. Exported and pure, so the breaks can be tested at a width rather than
 * through a renderer.
 */
export function statCardRows(count: number, width: number): { readonly perRow: number } {
    if (count <= 0) return { perRow: 1 };
    // Before the shell has a width (a bare render), one row, as the cards were always drawn.
    if (width <= 0) return { perRow: count };
    const fits = Math.max(1, Math.floor((width + STAT_CARD_GAP) / (cardWidth.min + STAT_CARD_GAP)));
    if (fits >= count) return { perRow: count };
    const rowCount = Math.ceil(count / fits);
    return { perRow: Math.ceil(count / rowCount) };
}

/** `gap-snug`, as a number for the arithmetic above. */
const STAT_CARD_GAP = 12;

function StatCard({
    card,
    pending,
    testID,
}: {
    readonly card: CatalogueStatCard;
    readonly pending: boolean | undefined;
    readonly testID: string;
}) {
    const tone = card.tone ?? 'default';

    const figure = (
        <View className="flex-row flex-wrap items-baseline gap-tight">
            {/*
             * `display` (20/26, 700), not the `mono` role. The design sets these figures
             * in IBM Plex Mono, and CLAUDE.md's sequencing decision defers that family
             * to the palette pass — "carry numerics with weight and alignment for now" —
             * so the figure takes the ramp's one large step and nothing else.
             */}
            <Text variant="display" tone={VALUE_TONE[tone]} testID={`${testID}-value`}>
                {card.value}
            </Text>
            {/*
             * The unit on the figure's own step, so "18 of 18" and "1 records" read as
             * one phrase at one size — ink, not size, separates the count from its noun.
             */}
            {card.unit === undefined ? null : (
                <Text variant="display" tone="secondary">
                    {card.unit}
                </Text>
            )}
        </View>
    );

    return (
        <Card
            tone={CARD_TONE[tone]}
            padding="md"
            interactive={card.onPress !== undefined}
            onPress={card.onPress}
            accessibilityLabel={card.accessibilityLabel}
            testID={testID}
        >
            {/*
             * One child, so `Card`'s own 8px gap between children never applies: these three lines
             * are a single block at 4px.
             */}
            <View className="flex-col gap-hair">
                <View className="flex-row items-baseline justify-between gap-tight">
                    <Text variant="title" tone="secondary" numberOfLines={1}>
                        {card.label}
                    </Text>
                    <Icon name={card.mark} size="lg" className={MARK_CLASS[tone]} />
                </View>

                {pending === true ? (
                    <View testID={`${testID}-loading`} className="flex-row items-center">
                        {/*
                         * The figure's own line box with nothing in it. It holds the card at its
                         * loaded height by the type ramp itself, so the placeholder cannot drift
                         * from the figure it stands in for when the ramp moves.
                         */}
                        <Text variant="display" aria-hidden>
                            {NO_BREAK_SPACE}
                        </Text>
                        <Skeleton heightClassName="h-5" widthClassName="w-1/3" />
                    </View>
                ) : pending === false ? (
                    <FadeIn>{figure}</FadeIn>
                ) : (
                    figure
                )}

                {card.caption === undefined ? null : (
                    <Text variant="body" tone={CAPTION_TONE[tone]} numberOfLines={2}>
                        {card.caption}
                    </Text>
                )}
            </View>
        </Card>
    );
}

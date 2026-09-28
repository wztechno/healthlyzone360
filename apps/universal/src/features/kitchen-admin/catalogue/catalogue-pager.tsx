import { Pagination, useDensity } from '@healthy360/design-system';
import { Text as RNText, View } from 'react-native';

/**
 * Part six (§4.1): the range on one side, compact page buttons on the other.
 *
 * ```
 * ( Showing 1–25 of 248 )                                    [ ‹ 1 2 3 … 10 › ]
 * ```
 *
 * The range is a caption and the buttons come from `Pagination`, which already owns the slot maths
 * (`paginationSlots`), the ellipsis and the direction-aware chevrons. Nothing is re-derived here:
 * the caller states the range because it is the only party that knows whether the 248 is the
 * filtered total or the unfiltered one, and on a catalogue those differ constantly.
 *
 * The range text arrives translated and interpolated for the reason the summary bar gives — a
 * range written as `{{from}}–{{to}}` in the catalogue can put the dash where the script wants it,
 * and one assembled here cannot.
 *
 * ## The range is drawn, not printed
 *
 * A line of grey caption under every list read as a footnote, and the two figures in it — the only
 * part anybody reads — were set in the same ink as "Showing" and "of". So the range sits in the
 * pager's own box, the same height, radius, border and fill as an unselected page button, and the
 * figures in it are set in the primary ink at semibold with fixed-advance digits while the words
 * stay secondary. The row then reads as one control family: where you are, and where you can go.
 *
 * The figures are found in the finished string rather than passed in, by {@link splitFigures}, so
 * every caller keeps handing over one translated sentence — "Showing 18 of 29" or "1–25 of 248" —
 * and every catalogue keeps its own word order and its own digits.
 */
export interface CataloguePagerProps {
    /** Translated and interpolated — "Showing 1–25 of 248". */
    readonly range: string;
    readonly page: number;
    readonly totalPages: number;
    readonly onPageChange: (page: number) => void;
    /** Accessible name for the page buttons. */
    readonly label: string;
    readonly testID: string;
}

/**
 * A run of digits — Western, Arabic-Indic or Extended Arabic-Indic — with any grouping or decimal
 * separators between them, so "1,248" and "١٬٢٤٨" are one figure rather than two.
 */
const FIGURE = /([0-9٠-٩۰-۹]+(?:[.,٫٬][0-9٠-٩۰-۹]+)*)/u;

export interface RangePart {
    readonly text: string;
    readonly figure: boolean;
}

/** Splits a translated range into its words and its figures, in the order the catalogue wrote them. */
export function splitFigures(range: string): readonly RangePart[] {
    return range
        .split(FIGURE)
        .map((text, index) => ({ text, figure: index % 2 === 1 }))
        .filter((part) => part.text.length > 0);
}

/**
 * The range on its own, for a list that states one without numbered pages — the ledger's cursor
 * walk, the procurement foot. The same box, so "Showing 18 of 29" looks the same on every list.
 *
 * The box is `Pagination`'s, ladder for ladder, so the two ends of a pager row match: the 24px
 * compact pill on the Catalogue. On a comfortable surface it takes the caption's own padding rather
 * than the 44px touch floor — it is a label, not a target.
 */
export function CatalogueRange({
    range,
    testID,
}: {
    /** Translated and interpolated — "Showing 18 of 29". */
    readonly range: string;
    readonly testID: string;
}) {
    const compact = useDensity() === 'compact';

    return (
        <View
            className={
                compact
                    ? 'h-control-xs justify-center rounded-sm border border-stroke-subtle bg-surface-raised px-control-xs'
                    : 'justify-center rounded-md border border-stroke-subtle bg-surface-raised px-3 py-2'
            }
        >
            <RNText
                testID={testID}
                className={
                    compact
                        ? 'text-role-caption text-content-secondary'
                        : 'text-sm text-content-secondary'
                }
            >
                {splitFigures(range).map((part, index) =>
                    part.figure ? (
                        <RNText
                            // The parts are positional and never reorder; the index is the identity.
                            key={index}
                            className="font-semibold tabular-nums text-content-primary"
                        >
                            {part.text}
                        </RNText>
                    ) : (
                        part.text
                    ),
                )}
            </RNText>
        </View>
    );
}

export function CataloguePager({
    range,
    page,
    totalPages,
    onPageChange,
    label,
    testID,
}: CataloguePagerProps) {
    return (
        <View testID={testID} className="flex-row flex-wrap items-center justify-between gap-tight">
            <CatalogueRange range={range} testID={`${testID}-range`} />
            {totalPages <= 1 ? null : (
                <Pagination
                    page={page}
                    totalPages={totalPages}
                    onPageChange={onPageChange}
                    label={label}
                    testID={`${testID}-pages`}
                />
            )}
        </View>
    );
}

import { Pagination, Text } from '@healthy360/design-system';
import { View } from 'react-native';

/**
 * Part six (§4.1): the range on one side, compact page buttons on the other.
 *
 * ```
 * Showing 1–25 of 248                                        [ ‹ 1 2 3 … 10 › ]
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
            <Text variant="caption" tone="secondary" testID={`${testID}-range`}>
                {range}
            </Text>
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

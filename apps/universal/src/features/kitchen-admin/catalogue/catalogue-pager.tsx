import { Pagination } from '@healthy360/design-system';
import { View } from 'react-native';

/**
 * Part six (§4.1): the page buttons, centred under the list.
 *
 * ```
 *                          [ ‹ 1 2 3 … 10 › ]
 * ```
 *
 * The buttons come from `Pagination`, which already owns the slot maths (`paginationSlots`), the
 * ellipsis and the direction-aware chevrons. Nothing is re-derived here.
 *
 * ## No range beside them
 *
 * This used to open with a "Showing 18 of 306" box at the start edge and push the buttons to the
 * end. The count said nothing the page did not already say — the summary card above every list
 * carries the same figure — and splitting the row to both edges left the pager hanging off the
 * table's corner. With the range gone the buttons are the whole row, and centred they sit under the
 * table they turn rather than beside one column of it.
 *
 * A list that fits on one page draws nothing: there is nowhere to go.
 */
/** Rows on one page of any admin table — the server's `perPage` and every client-side slice. */
export const CATALOGUE_PAGE_SIZE = 18;

export interface CataloguePagerProps {
    readonly page: number;
    readonly totalPages: number;
    readonly onPageChange: (page: number) => void;
    /** Accessible name for the page buttons. */
    readonly label: string;
    readonly testID: string;
}

export function CataloguePager({
    page,
    totalPages,
    onPageChange,
    label,
    testID,
}: CataloguePagerProps) {
    if (totalPages <= 1) return null;

    return (
        <View testID={testID} className="flex-row justify-center">
            <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={onPageChange}
                label={label}
                testID={`${testID}-pages`}
            />
        </View>
    );
}

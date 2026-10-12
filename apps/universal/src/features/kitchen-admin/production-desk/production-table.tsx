import { FormSection } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { useColumnControls } from '../catalogue/use-column-controls.tsx';

/**
 * Every table in the production flow, drawn one way.
 *
 * ```
 * Ingredients  12 lines  (i)                                   [ Columns ▾ ]
 * ┌ ITEM ▲          REQUIRED ▲   CLAIMED ▲   USED ▲   UNIT COST ▲ ┐
 * │ Mayonnaise      1.203 kg     1.203 kg    —        —           │
 * └────────────────────────────────────────────────────────────────┘
 * ```
 *
 * The batch planner, the new batch's preview, a batch's plan and its claimed lines each drew their
 * tables differently — a `Table`, a bare `DataList` under a heading, a `CatalogueList` in a section
 * — so the same shelf looked like a different thing at every step. This is the batch planner's
 * shape, once: a `FormSection` whose title names the table, the `ColumnPicker` at its end, and the
 * admin's `CatalogueList` at `sm` with headers that sort and filter from the column spec.
 *
 * In-memory rows only: every production table holds the whole set, so the hook sorts and filters
 * what it was given and `CatalogueList` pages it like any other admin table.
 */

export interface ProductionTableProps<Row> {
    /** The list's testID, and the prefix for its headers and the remembered column choice. */
    readonly testID: string;
    /** The section's testID, where a suite already names it. Defaults to `${testID}-section`. */
    readonly sectionTestID?: string | undefined;
    readonly title: string;
    /** Beside the title — a count, a badge. */
    readonly aside?: ReactNode | undefined;
    /** Guidance behind the title's (i). Never a sentence on the page. */
    readonly description?: string | undefined;
    /** No hairline over it: the first section of its column. */
    readonly first?: boolean | undefined;
    readonly rows: readonly Row[];
    readonly columns: readonly ControlledColumn<Row, CatalogueColumn<Row>>[];
    readonly rowKey: (row: Row) => string;
    /** Drawn in place of the list, with no column picker, when there are no rows. */
    readonly empty?: ReactNode | undefined;
}

export function ProductionTable<Row>({
    testID,
    sectionTestID,
    title,
    aside,
    description,
    first = false,
    rows,
    columns,
    rowKey,
    empty,
}: ProductionTableProps<Row>) {
    const { t } = useTranslation();
    const controls = useColumnControls(rows, columns, testID);

    return (
        <FormSection
            first={first}
            testID={sectionTestID ?? `${testID}-section`}
            title={title}
            aside={aside}
            description={description}
            actions={
                rows.length === 0 && empty !== undefined ? undefined : (
                    <ColumnPicker {...controls.picker} />
                )
            }
        >
            {rows.length === 0 && empty !== undefined ? (
                empty
            ) : (
                <CatalogueList<Row>
                    testID={testID}
                    label={title}
                    columns={controls.columns}
                    rows={controls.rows}
                    rowKey={rowKey}
                    density="sm"
                    rowActionsLabel={t('kitchen:list.rowActions')}
                />
            )}
        </FormSection>
    );
}

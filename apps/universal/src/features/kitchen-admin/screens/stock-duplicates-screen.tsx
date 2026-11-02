import type { DuplicateStockGroup } from '@healthy360/api-client/contracts';
import { Cascade, EmptyState, ErrorState, TableSkeleton, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useDuplicateStockQuery } from '../../../data/kitchen-ops-hooks.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';

/**
 * `/kitchen/stock-duplicates` — the stock rows sharing a name that `kitchen:merge-duplicate-stock`
 * left for a person, each with its reason. Read-only: a row leaves the list when the kitchen deals
 * with it, by archiving, renaming or counting a shelf out.
 */
export function StockDuplicatesScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-stock-duplicates"
        >
            <StockDuplicatesList />
        </Gate>
    );
}

function StockDuplicatesList() {
    const { t } = useTranslation();
    const duplicates = useDuplicateStockQuery();
    const failure = toFailure(duplicates.error);
    const rows = duplicates.data ?? [];

    const shelvesOf = (row: DuplicateStockGroup): string =>
        row.shelves
            .map((shelf) =>
                t('kitchen:stockDuplicates.shelf', {
                    code: shelf.code,
                    quantity: Number(shelf.quantity),
                    unit: shelf.unitCode,
                }),
            )
            .join(' · ');

    const columns: readonly CatalogueColumn<DuplicateStockGroup>[] = [
        {
            key: 'name',
            role: 'title',
            label: t('kitchen:stockDuplicates.columnName'),
            width: 220,
            priority: 100,
            value: (row) => row.name,
            render: (row) => <Text variant="strong">{row.name}</Text>,
        },
        {
            key: 'reason',
            role: 'meta',
            label: t('kitchen:stockDuplicates.columnReason'),
            width: 320,
            priority: 90,
            value: (row) => t(`kitchen:stockDuplicates.reason.${row.reason}`),
        },
        {
            key: 'shelves',
            role: 'meta',
            label: t('kitchen:stockDuplicates.columnShelves'),
            width: 320,
            priority: 80,
            value: shelvesOf,
        },
    ];

    return (
        <Cascade space="md" testID="kitchen-stock-duplicates-screen">
            {duplicates.isPending ? (
                <TableSkeleton
                    testID="kitchen-stock-duplicates-loading"
                    partTestID="kitchen-stock-duplicates"
                />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-stock-duplicates-error"
                    failure={failure}
                    onRetry={() => {
                        void duplicates.refetch();
                    }}
                    retrying={duplicates.isFetching}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-stock-duplicates-empty"
                    title={t('kitchen:stockDuplicates.emptyTitle')}
                    body={t('kitchen:stockDuplicates.emptyBody')}
                />
            ) : (
                <CatalogueList<DuplicateStockGroup>
                    testID="kitchen-stock-duplicates-table"
                    label={t('kitchen:stockDuplicates.caption')}
                    columns={columns}
                    rows={rows}
                    rowKey={(row) => row.name}
                    density="sm"
                    rowActionsLabel={t('kitchen:list.rowActions')}
                />
            )}
        </Cascade>
    );
}

import type { ProductionOrder, ProductionOrderStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    EmptyState,
    ErrorState,
    SegmentedControl,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useProductionOrdersQuery } from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import { PRODUCTION_VIEW_PERMISSION } from '../entity-registry.ts';
import { productionBatchTestId, productionStatusKey, productionStatusTone } from '../ops-format.ts';
import { countByStatus, countExpired, yieldSummary } from '../production-desk/batch-figures.ts';

/**
 * `/kitchen/production-desk/batches` — the batches nobody has to move any more (PROD1).
 *
 * ```
 * ┌ COMPLETED ┐ ┌ EXPIRED ┐
 * SHOWING [ Completed | Cancelled | Abandoned ]
 * BATCH        MAKES             MADE ON      USE BY       STORED IN   YIELD       STATUS
 * PB-7K3MQ9ZV  Caesar dressing   2026-09-14   2026-09-21   Chill 2     19.5 l      [COMPLETED]
 * ```
 *
 * ## It is the desk's list narrowed, not a second book
 *
 * Same endpoint, same rows, one filter — because a register that fetched its own would eventually
 * disagree with the desk about what a batch produced, and the disagreement would surface on the day
 * somebody was reconciling stock. The desk shows what is still moving; this shows what has stopped.
 *
 * ## A batch with no expiry date is never counted as expired
 *
 * That is "nobody recorded one", which is not the same as "it is fine" and not the same as "it has
 * gone off". The column says so in words rather than showing a blank that reads as safe, and
 * {@link countExpired} leaves it out of the tile. A register that quietly treated the unknown as
 * good is the one that poisons somebody.
 *
 * Read-only: the family carries no manage permission and nothing here writes. Every edge a batch
 * has lives on the batch itself, which holds the lock version.
 */

export function ProductionBatchesScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [PRODUCTION_VIEW_PERMISSION] }}
            testID="kitchen-production-batches"
        >
            <ProductionBatches />
        </Gate>
    );
}

/** The three terminal states. The open ones are the desk's. */
const SETTLED_STATUSES = [
    'completed',
    'cancelled',
    'abandoned',
] as const satisfies readonly ProductionOrderStatus[];

type SettledStatus = (typeof SETTLED_STATUSES)[number];

function ProductionBatches() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const access = useAccessState();
    const branchId = access.branch?.id ?? null;

    const [status, setStatus] = useState<SettledStatus>('completed');
    const [page, setPage] = useState(1);

    const batches = useProductionOrdersQuery({
        status,
        ...(branchId === null ? {} : { branchId }),
        page,
    });

    const rows = batches.data?.orders ?? [];
    const hasMore = batches.data?.hasMore ?? false;
    const failure = toFailure(batches.error);
    const hasData = !batches.isPending && failure === null;
    const noValue = t('kitchen:list.noValue');

    const tile = (value: number | null): string =>
        value === null ? noValue : formatter.formatNumber(value);

    const referenceLabel = (row: ProductionOrder) =>
        row.reference ?? t('kitchen:ops.production.unreferenced');
    const makesLabel = (row: ProductionOrder) => row.productionItemNameEn ?? noValue;

    const columns: readonly ControlledColumn<ProductionOrder, CatalogueColumn<ProductionOrder>>[] =
        [
            {
                key: 'reference',
                role: 'title',
                value: (row) => referenceLabel(row),
                label: t('kitchen:ops.production.columnBatch'),
                width: 160,
                priority: 100,
                sort: (left, right, direction) =>
                    compareText(referenceLabel(left), referenceLabel(right), direction),
                render: (row) => (
                    <View className="min-w-0 flex-col py-1">
                        <Text variant="mono" className="font-medium">
                            {referenceLabel(row)}
                        </Text>
                        {row.batchReference === null ? null : (
                            <Text variant="caption" tone="secondary" numberOfLines={1}>
                                {row.batchReference}
                            </Text>
                        )}
                    </View>
                ),
            },
            {
                key: 'makes',
                role: 'meta',
                label: t('kitchen:ops.production.columnMakes'),
                width: 180,
                priority: 90,
                sort: (left, right, direction) =>
                    compareText(makesLabel(left), makesLabel(right), direction),
                render: (row) => <Text numberOfLines={1}>{makesLabel(row)}</Text>,
            },
            {
                key: 'made',
                role: 'meta',
                label: t('kitchen:ops.production.columnMade'),
                width: 130,
                priority: 70,
                sort: (left, right, direction) =>
                    compareText(left.productionDate, right.productionDate, direction),
                render: (row) => (
                    <Text variant="mono" tone="secondary">
                        {row.productionDate ?? noValue}
                    </Text>
                ),
            },
            {
                key: 'expiry',
                role: 'meta',
                label: t('kitchen:ops.production.columnExpiry'),
                width: 150,
                priority: 80,
                sort: (left, right, direction) =>
                    compareText(left.expiryDate, right.expiryDate, direction),
                render: (row) =>
                    row.expiryDate === null ? (
                        // Never a blank: a blank in a use-by column reads as "fine".
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.production.noExpiry')}
                        </Text>
                    ) : (
                        <View className="flex-row flex-wrap items-center gap-1.5">
                            <Text variant="mono" tone={row.isExpired ? 'danger' : 'secondary'}>
                                {row.expiryDate}
                            </Text>
                            {row.isExpired ? (
                                <Badge
                                    testID={`${productionBatchTestId(String(row.id))}-expired`}
                                    tone="danger"
                                    label={t('kitchen:ops.production.expiredBadge')}
                                />
                            ) : null}
                        </View>
                    ),
            },
            {
                key: 'storage',
                role: 'meta',
                label: t('kitchen:ops.production.columnStorage'),
                width: 140,
                priority: 50,
                sort: (left, right, direction) =>
                    compareText(left.storageLocation, right.storageLocation, direction),
                render: (row) => (
                    <Text tone="secondary" numberOfLines={1}>
                        {row.storageLocation ?? noValue}
                    </Text>
                ),
            },
            {
                key: 'yield',
                role: 'metric',
                label: t('kitchen:ops.production.columnYield'),
                width: 140,
                priority: 75,
                align: 'end',
                render: (row) => (
                    <Text variant="mono" testID={`${productionBatchTestId(String(row.id))}-yield`}>
                        {yieldSummary(row) ?? noValue}
                    </Text>
                ),
            },
            {
                key: 'status',
                role: 'status',
                label: t('kitchen:ops.production.columnStatus'),
                width: 140,
                priority: 85,
                render: (row) => (
                    <Badge
                        testID={`${productionBatchTestId(String(row.id))}-status`}
                        tone={productionStatusTone(row.status)}
                        label={t(productionStatusKey(row.status))}
                    />
                ),
            },
        ];

    const controls = useColumnControls(rows, columns, 'kitchen-production-batches-table');

    return (
        <Stack space="md" testID="kitchen-production-batches-screen">
            {!hasData ? null : (
                <CatalogueStatCards
                    testID="kitchen-production-batches-summary"
                    cards={[
                        {
                            key: 'settled',
                            label: t(productionStatusKey(status)),
                            value: tile(countByStatus(rows, status, hasMore)),
                            unit: t('kitchen:ops.production.statUnit'),
                            caption: t('kitchen:ops.production.statCompletedCaption'),
                            mark: 'check',
                            tone: 'default',
                        },
                        {
                            key: 'expired',
                            label: t('kitchen:ops.production.statExpired'),
                            value: tile(countExpired(rows, hasMore)),
                            unit: t('kitchen:ops.production.statUnit'),
                            caption: t('kitchen:ops.production.statExpiredCaption'),
                            mark: 'warning',
                            tone: (countExpired(rows, hasMore) ?? 0) > 0 ? 'danger' : 'default',
                        },
                    ]}
                />
            )}

            <View
                testID="kitchen-production-batches-toolbar"
                className="z-10 min-h-control-sm flex-row flex-wrap items-center gap-snug"
            >
                <SegmentedControl<SettledStatus>
                    testID="kitchen-production-batches-filter"
                    label={t('kitchen:ops.production.filterStatus')}
                    value={status}
                    onChange={(next) => {
                        setStatus(next);
                        setPage(1);
                    }}
                    items={SETTLED_STATUSES.map((value) => ({
                        value,
                        label: t(productionStatusKey(value)),
                        testID: `kitchen-production-batches-filter-${value}`,
                    }))}
                />
            </View>

            {batches.isPending ? (
                <Skeleton testID="kitchen-production-batches-loading" heightClassName="h-40" />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-production-batches-error"
                    failure={failure}
                    onRetry={() => {
                        void batches.refetch();
                    }}
                    retrying={batches.isFetching}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-production-batches-empty"
                    title={t('kitchen:ops.production.registerEmptyTitle')}
                    body={t('kitchen:ops.production.registerEmptyBody')}
                />
            ) : (
                <View className="flex-col gap-2.5">
                    <CatalogueList<ProductionOrder>
                        testID="kitchen-production-batches-table"
                        label={t('kitchen:ops.production.registerTitle')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => String(row.id)}
                        onRowPress={(row) => {
                            router.push(`/kitchen/production-desk/${String(row.id)}`);
                        }}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                    />
                    <View className="flex-row flex-wrap items-center justify-between gap-snug">
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.production.showingCount', { count: rows.length })}
                        </Text>
                        <View className="flex-row items-center gap-snug">
                            {page > 1 ? (
                                <Button
                                    testID="kitchen-production-batches-previous"
                                    variant="secondary"
                                    size="sm"
                                    label={t('kitchen:ops.production.previousPage')}
                                    onPress={() => {
                                        setPage(page - 1);
                                    }}
                                />
                            ) : null}
                            {hasMore ? (
                                <Button
                                    testID="kitchen-production-batches-next"
                                    variant="secondary"
                                    size="sm"
                                    label={t('kitchen:ops.production.nextPage')}
                                    onPress={() => {
                                        setPage(page + 1);
                                    }}
                                />
                            ) : null}
                        </View>
                    </View>
                </View>
            )}
        </Stack>
    );
}

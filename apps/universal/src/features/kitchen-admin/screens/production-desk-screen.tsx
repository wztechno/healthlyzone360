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
    useToast,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useConfirmProductionOrderMutation,
    useProductionOrdersQuery,
    useStartProductionOrderMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import type { MenuItem } from '@healthy360/design-system';

import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import { PRODUCTION_MANAGE_PERMISSION, PRODUCTION_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    nextProductionEdge,
    productionBatchTestId,
    productionStatusKey,
    productionStatusTone,
} from '../ops-format.ts';
import { countByStatus, countUnvalued, yieldSummary } from '../production-desk/batch-figures.ts';

/**
 * `/kitchen/production-desk` — the batches this kitchen still has to do something about (PROD1).
 *
 * ```
 * ┌ DRAFTS ┐ ┌ CONFIRMED ┐ ┌ IN PRODUCTION ┐ ┌ UNVALUED ┐
 * SHOWING [ Open | Draft | Confirmed | In production | Completed | Cancelled | Abandoned ]
 * BATCH        MAKES              YIELD            STATUS            ACTION
 * PB-7K3MQ9ZV  Caesar dressing    37 / 38 l        [COMPLETED]       —
 * PB-2X8PVB4C  Frozen lasagne     40 l             [CONFIRMED]       Start
 * ```
 *
 * ## It defaults to open work, and the register is the same list narrowed
 *
 * A desk is a working surface: what it is for is the batches somebody still has to move. So the
 * filter opens on the four open states — the server's own default — and narrowing it to one is how
 * `/batches` reads the finished ones out of the same endpoint rather than needing a second.
 *
 * ## The cards go quiet the moment the page is not the queue
 *
 * Fifty per page with `hasMore` stated. A count over what happened to be on screen would read as a
 * fact about the kitchen, so every figure returns null past the first page and the tile shows an em
 * dash — the workspace's rule for a count it could not earn. {@link countByStatus} holds it.
 *
 * ## There is no complete button here
 *
 * Confirm and start take no information, so a row can offer them. Completing needs what actually
 * came out — produced, rejected, what went in the pot and what went on the floor — and a one-click
 * complete would have to invent a produced quantity. The batch screen asks; the row says nothing.
 * {@link nextProductionEdge} holds that rule for both surfaces.
 *
 * Behind `production.view_organisation`; the row actions additionally need
 * `production.manage_organisation`. Money is redacted inside the payload, so a chef reads every
 * quantity here and the Unvalued tile shows an em dash rather than a zero.
 */
export function ProductionDeskScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [PRODUCTION_VIEW_PERMISSION] }}
            testID="kitchen-production-desk"
        >
            <ProductionDesk />
        </Gate>
    );
}

/** `open` is the server's default — the four states somebody still has to move. */
type DeskFilter = 'open' | ProductionOrderStatus;

function ProductionDesk() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const router = useRouter();
    const access = useAccessState();
    const canManage = useCan(PRODUCTION_MANAGE_PERMISSION);
    const branchId = access.branch?.id ?? null;

    const [filter, setFilter] = useState<DeskFilter>('open');
    const [page, setPage] = useState(1);
    const [pendingId, setPendingId] = useState<string | null>(null);

    const batches = useProductionOrdersQuery({
        ...(filter === 'open' ? {} : { status: filter }),
        ...(branchId === null ? {} : { branchId }),
        page,
    });

    const confirmBatch = useConfirmProductionOrderMutation();
    const startBatch = useStartProductionOrderMutation();

    const rows = batches.data?.orders ?? [];
    const hasMore = batches.data?.hasMore ?? false;
    const failure = toFailure(batches.error);
    const hasData = !batches.isPending && failure === null;

    /** A filter change is a navigation: the page goes with it. */
    const refilter = (next: DeskFilter) => {
        setFilter(next);
        setPage(1);
    };

    /** `null` is an em dash, not a zero — see the file header. */
    const tile = (value: number | null): string =>
        value === null ? t('kitchen:list.noValue') : formatter.formatNumber(value);

    const advance = (row: ProductionOrder) => {
        const edge = nextProductionEdge(row.status);
        if (edge === null) return;

        setPendingId(String(row.id));

        const variables = { productionOrderId: row.id, lockVersion: row.lockVersion };
        const onSuccess = () => {
            toast.show({
                testID: 'kitchen-production-desk-advanced-toast',
                tone: 'success',
                message: t(
                    edge === 'confirm'
                        ? 'kitchen:ops.production.confirmedToast'
                        : 'kitchen:ops.production.startedToast',
                ),
            });
        };
        const onSettled = () => {
            setPendingId(null);
        };

        if (edge === 'confirm') {
            confirmBatch.mutate(variables, { onSuccess, onSettled });

            return;
        }

        startBatch.mutate(variables, { onSuccess, onSettled });
    };

    const makesLabel = (row: ProductionOrder) =>
        row.productionItemNameEn ?? t('kitchen:list.noValue');
    const referenceLabel = (row: ProductionOrder) =>
        row.reference ?? t('kitchen:ops.production.unreferenced');

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
                        <Text
                            variant="mono"
                            className="font-medium"
                            testID={`${productionBatchTestId(String(row.id))}-reference`}
                        >
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
                width: 200,
                priority: 90,
                sort: (left, right, direction) =>
                    compareText(makesLabel(left), makesLabel(right), direction),
                render: (row) => (
                    <Text
                        numberOfLines={1}
                        testID={`${productionBatchTestId(String(row.id))}-makes`}
                    >
                        {makesLabel(row)}
                    </Text>
                ),
            },
            {
                key: 'yield',
                role: 'metric',
                label: t('kitchen:ops.production.columnYield'),
                width: 140,
                priority: 70,
                align: 'end',
                render: (row) => (
                    <Text
                        variant="mono"
                        tone="secondary"
                        testID={`${productionBatchTestId(String(row.id))}-yield`}
                    >
                        {/*
                         * Usable *and* produced where they differ, which is exactly when something was
                         * thrown away. Before the batch is settled this is an em dash rather than a
                         * zero: it has produced nothing **yet**.
                         */}
                        {yieldSummary(row) ?? planned(row, t('kitchen:list.noValue'))}
                    </Text>
                ),
            },
            {
                key: 'status',
                role: 'status',
                label: t('kitchen:ops.production.columnStatus'),
                width: 150,
                priority: 95,
                render: (row) => (
                    <View className="flex-row flex-wrap items-center gap-1.5">
                        <Badge
                            testID={`${productionBatchTestId(String(row.id))}-status`}
                            tone={productionStatusTone(row.status)}
                            label={t(productionStatusKey(row.status))}
                        />
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
        ];

    /**
     * The one edge a row can take, as the list's own row action.
     *
     * `CatalogueList` draws these as buttons beside the row above `md` and folds them into the
     * overflow menu below it, and the `actions` track is undroppable at every width — which a
     * column of my own would not have been. An empty list is no control at all rather than a
     * disabled one: a batch in production has an edge, and it is a form.
     */
    const rowActions = (row: ProductionOrder): readonly MenuItem[] => {
        const edge = canManage ? nextProductionEdge(row.status) : null;
        if (edge === null) return [];

        return [
            {
                key: edge,
                testID: `${productionBatchTestId(String(row.id))}-${edge}`,
                icon: edge === 'confirm' ? 'check' : 'chevronEnd',
                label: t(
                    edge === 'confirm'
                        ? 'kitchen:ops.production.confirm'
                        : 'kitchen:ops.production.start',
                ),
                disabled: pendingId === String(row.id),
                onSelect: () => {
                    advance(row);
                },
            },
        ];
    };

    const controls = useColumnControls(rows, columns, 'kitchen-production-desk-table');

    return (
        <Stack space="md" testID="kitchen-production-desk-screen">
            {!hasData ? null : (
                <CatalogueStatCards
                    testID="kitchen-production-desk-summary"
                    cards={[
                        {
                            key: 'draft',
                            label: t('kitchen:ops.production.status.draft'),
                            value: tile(countByStatus(rows, 'draft', hasMore)),
                            unit: t('kitchen:ops.production.statUnit'),
                            caption: t('kitchen:ops.production.statDraftCaption'),
                            mark: 'calendar',
                            tone: 'default',
                            onPress: () => {
                                refilter('draft');
                            },
                            accessibilityLabel: t('kitchen:ops.production.status.draft'),
                        },
                        {
                            key: 'confirmed',
                            label: t('kitchen:ops.production.status.confirmed'),
                            value: tile(countByStatus(rows, 'confirmed', hasMore)),
                            unit: t('kitchen:ops.production.statUnit'),
                            caption: t('kitchen:ops.production.statConfirmedCaption'),
                            mark: 'check',
                            tone: 'brand',
                            onPress: () => {
                                refilter('confirmed');
                            },
                            accessibilityLabel: t('kitchen:ops.production.status.confirmed'),
                        },
                        {
                            key: 'inProduction',
                            label: t('kitchen:ops.production.status.inProduction'),
                            value: tile(countByStatus(rows, 'in_production', hasMore)),
                            unit: t('kitchen:ops.production.statUnit'),
                            caption: t('kitchen:ops.production.statInProductionCaption'),
                            mark: 'calendar',
                            tone: 'brand',
                            onPress: () => {
                                refilter('in_production');
                            },
                            accessibilityLabel: t('kitchen:ops.production.status.inProduction'),
                        },
                        {
                            key: 'unvalued',
                            label: t('kitchen:ops.production.statUnvalued'),
                            value: tile(countUnvalued(rows, hasMore)),
                            unit: t('kitchen:ops.production.statUnit'),
                            caption: t('kitchen:ops.production.statUnvaluedCaption'),
                            mark: 'warning',
                            tone: (countUnvalued(rows, hasMore) ?? 0) > 0 ? 'danger' : 'default',
                        },
                    ]}
                />
            )}

            <View
                testID="kitchen-production-desk-toolbar"
                className="z-10 min-h-control-sm flex-row flex-wrap items-center gap-snug"
            >
                <SegmentedControl<DeskFilter>
                    testID="kitchen-production-desk-filter"
                    label={t('kitchen:ops.production.filterStatus')}
                    value={filter}
                    onChange={refilter}
                    items={(
                        [
                            ['open', 'kitchen:ops.production.filterOpen'],
                            ['completed', 'kitchen:ops.production.status.completed'],
                            ['cancelled', 'kitchen:ops.production.status.cancelled'],
                            ['abandoned', 'kitchen:ops.production.status.abandoned'],
                        ] as const
                    ).map(([value, labelKey]) => ({
                        value,
                        label: t(labelKey),
                        testID: `kitchen-production-desk-filter-${value}`,
                    }))}
                />
                {canManage ? (
                    <Button
                        testID="kitchen-production-desk-new"
                        size="sm"
                        label={t('kitchen:ops.production.create')}
                        onPress={() => {
                            router.push('/kitchen/production-desk/new');
                        }}
                    />
                ) : null}
            </View>

            {batches.isPending ? (
                <View testID="kitchen-production-desk-loading" className="flex-col">
                    {Array.from({ length: 8 }, (_, index) => (
                        <View
                            key={index}
                            className="h-row-md flex-row items-center border-b border-stroke-subtle"
                        >
                            <Skeleton heightClassName="h-2" />
                        </View>
                    ))}
                </View>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-production-desk-error"
                    failure={failure}
                    onRetry={() => {
                        void batches.refetch();
                    }}
                    retrying={batches.isFetching}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-production-desk-empty"
                    title={t('kitchen:ops.production.emptyTitle')}
                    body={t('kitchen:ops.production.emptyBody')}
                />
            ) : (
                <View className="flex-col gap-2.5">
                    <CatalogueList<ProductionOrder>
                        testID="kitchen-production-desk-table"
                        label={t('kitchen:ops.production.title')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => String(row.id)}
                        onRowPress={(row) => {
                            router.push(`/kitchen/production-desk/${String(row.id)}`);
                        }}
                        rowActions={rowActions}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                    />
                    <View className="flex-row flex-wrap items-center justify-between gap-snug">
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.production.showingCount', { count: rows.length })}
                        </Text>
                        <View className="flex-row items-center gap-snug">
                            {page > 1 ? (
                                <Button
                                    testID="kitchen-production-desk-previous"
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
                                    testID="kitchen-production-desk-next"
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

/**
 * What a batch is *meant* to make, for a row that has not produced anything yet.
 *
 * A planned figure and a produced one are different claims, so the column shows the planned one
 * only while there is no produced one, and falls back to the em dash rather than to a zero when the
 * batch does not even say what it intends.
 */
function planned(row: ProductionOrder, fallback: string): string {
    if (row.plannedYield === null) return fallback;

    return `${row.plannedYield} ${row.plannedYieldUnitCode ?? ''}`.trim();
}

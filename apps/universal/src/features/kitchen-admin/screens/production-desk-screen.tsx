import type { ProductionOrder, ProductionOrderStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    Icon,
    TableSkeleton,
    Text,
    useToast,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
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
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import { LensBar, LensScope } from '../catalogue/lens-bar.tsx';
import type { LensFigure } from '../catalogue/lens-bar.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import { PRODUCTION_MANAGE_PERMISSION, PRODUCTION_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    nextProductionEdge,
    productionBatchTestId,
    productionStatusKey,
    productionStatusTone,
} from '../ops-format.ts';
import {
    countByStatus,
    countUnvalued,
    formatLot,
    yieldSummary,
} from '../production-desk/batch-figures.ts';
import { trimDecimal } from '../format.ts';

/**
 * `/kitchen/production-desk` — the batches this kitchen still has to do something about (PROD1).
 *
 * ```
 * (All batches 12) │ ● Draft 4  ● Confirmed 5  ● In production 3 │ ● Unvalued 1    [+ New batch]
 * [Showing Open ▾] [⌕ Search batches       ]                                 12 of 12 │ ▤
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
 * ## The figures go quiet the moment the page is not the queue
 *
 * Fifty per page with `hasMore` stated. A count over what happened to be on screen would read as a
 * fact about the kitchen, so every figure returns null past the first page and the bar shows an em
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
 * quantity here and the Unvalued figure shows an em dash rather than a zero.
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
    const toast = useToast();
    const router = useRouter();
    const access = useAccessState();
    const canManage = useCan(PRODUCTION_MANAGE_PERMISSION);
    const branchId = access.branch?.id ?? null;

    const [filter, setFilter] = useState<DeskFilter>('open');
    const [query, setQuery] = useState('');
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

    /** A filter change is a navigation: the page goes with it. */
    const refilter = (next: DeskFilter) => {
        setFilter(next);
        setPage(1);
    };

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
        // A refused edge used to leave the row as it was with nothing said.
        const onError = (error: unknown) => {
            toast.show({
                testID: 'kitchen-production-desk-advance-failed-toast',
                tone: 'danger',
                message: `${t(
                    edge === 'confirm'
                        ? 'kitchen:ops.production.confirmFailedTitle'
                        : 'kitchen:ops.production.startFailedTitle',
                )}. ${toFailure(error)?.message ?? ''}`.trim(),
            });
        };
        const onSettled = () => {
            setPendingId(null);
        };

        if (edge === 'confirm') {
            confirmBatch.mutate(variables, { onSuccess, onError, onSettled });

            return;
        }

        startBatch.mutate(variables, { onSuccess, onError, onSettled });
    };

    const makesLabel = (row: ProductionOrder) =>
        row.productionItemNameEn ?? t('kitchen:list.noValue');
    const referenceLabel = (row: ProductionOrder) =>
        row.reference ?? t('kitchen:ops.production.unreferenced');
    // The lot, or what a cook typed on the tray before lots were minted.
    const lotCaption = (row: ProductionOrder) => formatLot(row.lotNumber) ?? row.batchReference;

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
                        {lotCaption(row) === null ? null : (
                            <Text variant="caption" tone="secondary" numberOfLines={1}>
                                {lotCaption(row)}
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

    /*
     * The search narrows the page in hand, in memory — the batch number, the lot as printed and as
     * stored, what the batch makes. The endpoint takes no free-text query, and the page is the
     * queue the desk is working through, which is what somebody looking for "the lasagne" means.
     */
    const needle = query.trim().toLowerCase();
    const searched =
        needle === ''
            ? rows
            : rows.filter((row) =>
                  [
                      row.reference,
                      row.batchReference,
                      row.lotNumber,
                      formatLot(row.lotNumber),
                      row.productionItemNameEn,
                  ].some((field) => field?.toLowerCase().includes(needle) === true),
              );

    const controls = useColumnControls(searched, columns, 'kitchen-production-desk-table');

    return (
        <Cascade space="md" testID="kitchen-production-desk-screen">
            <LensBar
                testID="kitchen-production-desk-toolbar"
                label={t('kitchen:lens.label')}
                // A failed read counts nothing: its figures are dashes, as past the first page.
                figures={lensFigures(
                    {
                        rows,
                        hasMore: hasMore || failure !== null,
                        pending: batches.isPending,
                        filter,
                        refilter,
                    },
                    t,
                )}
                {...(filter === 'open' && !hasMore && !batches.isPending && failure === null
                    ? {
                          mix: OPEN_STATUSES.map(([status]) => ({
                              key: status,
                              value: rows.filter((row) => row.status === status).length,
                              tone: productionStatusTone(status),
                          })),
                          mixLabel: t('kitchen:lens.batchMix', {
                              draft: countByStatus(rows, 'draft', false),
                              confirmed: countByStatus(rows, 'confirmed', false),
                              inProduction: countByStatus(rows, 'in_production', false),
                          }),
                      }
                    : {})}
                scope={
                    <LensScope<DeskScope>
                        testID="kitchen-production-desk-toolbar-status"
                        label={t('kitchen:ops.production.filterStatus')}
                        // A figure narrows inside Open; the picker still says where it stands.
                        value={isDeskScope(filter) ? filter : 'open'}
                        onChange={refilter}
                        options={DESK_SCOPES.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey),
                            testID: `kitchen-production-desk-toolbar-status-${value}`,
                        }))}
                    />
                }
                search={query}
                onSearchChange={setQuery}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:ops.production.searchPlaceholder')}
                result={
                    batches.isPending
                        ? null
                        : failure !== null
                          ? t('kitchen:list.noValue')
                          : t('kitchen:lens.result', { shown: searched.length, total: rows.length })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(query === '' && filter === 'open'
                    ? {}
                    : {
                          onClear: () => {
                              setQuery('');
                              refilter('open');
                          },
                      })}
                trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
                actions={
                    canManage ? (
                        <Button
                            testID="kitchen-production-desk-new"
                            size="sm"
                            label={t('kitchen:ops.production.create')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={() => {
                                router.push('/kitchen/production-desk/new');
                            }}
                        />
                    ) : undefined
                }
            />

            {batches.isPending ? (
                <TableSkeleton testID="kitchen-production-desk-loading" rows={8} />
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
            ) : searched.length === 0 ? (
                <EmptyState
                    testID="kitchen-production-desk-no-match"
                    title={t('kitchen:ops.production.filteredEmptyTitle')}
                    body={t('kitchen:ops.production.filteredEmptyBody')}
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
                    <View className="flex-row flex-wrap items-center justify-center gap-snug">
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
            )}
        </Cascade>
    );
}

/** The open states, which the desk's figures narrow to inside Open. */
const OPEN_STATUSES = [
    ['draft', 'kitchen:lens.draftBatchesAction'],
    ['confirmed', 'kitchen:lens.confirmedBatchesAction'],
    ['in_production', 'kitchen:lens.inProductionBatchesAction'],
] as const satisfies readonly (readonly [ProductionOrderStatus, string])[];

/** The status picker's settings: Open, or one of the states nobody has to move any more. */
const DESK_SCOPES = [
    ['open', 'kitchen:ops.production.filterOpen'],
    ['completed', 'kitchen:ops.production.status.completed'],
    ['cancelled', 'kitchen:ops.production.status.cancelled'],
    ['abandoned', 'kitchen:ops.production.status.abandoned'],
] as const;

type DeskScope = (typeof DESK_SCOPES)[number][0];

function isDeskScope(filter: DeskFilter): filter is DeskScope {
    return DESK_SCOPES.some(([value]) => value === filter);
}

/**
 * The Lens bar's figures: the page's batches, the three open states as filters, then Unvalued.
 *
 * A count the page cannot earn — past the first page — is drawn as the em dash on a zero, so it
 * neither raises the alarm nor reads as a number.
 */
function lensFigures(
    source: {
        readonly rows: readonly ProductionOrder[];
        readonly hasMore: boolean;
        readonly pending: boolean;
        readonly filter: DeskFilter;
        readonly refilter: (next: DeskFilter) => void;
    },
    t: TFunction,
): readonly LensFigure[] {
    const { rows, hasMore, pending, filter, refilter } = source;
    const figure = (count: number | null) =>
        pending
            ? { value: null }
            : count === null
              ? { value: 0, display: t('kitchen:list.noValue') }
              : { value: count };

    return [
        {
            key: 'all',
            label: t('kitchen:lens.allBatches'),
            // Narrowed to one state, the page holds only that state: the whole is unknown.
            ...figure(isDeskScope(filter) && !hasMore ? rows.length : null),
            active: isDeskScope(filter),
            onPress: () => {
                refilter(isDeskScope(filter) ? filter : 'open');
            },
            accessibilityLabel: t('kitchen:lens.allAction'),
        },
        ...OPEN_STATUSES.map(([status, action], index) => ({
            key: status,
            label: t(productionStatusKey(status)),
            ...figure(countByStatus(rows, status, hasMore)),
            tone: productionStatusTone(status),
            separated: index === 0,
            active: filter === status,
            onPress: () => {
                refilter(status);
            },
            accessibilityLabel: t(action),
        })),
        {
            key: 'unvalued',
            label: t('kitchen:ops.production.statUnvalued'),
            ...figure(countUnvalued(rows, hasMore)),
            tone: 'danger',
            alarm: true,
            separated: true,
        },
    ];
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

    return `${trimDecimal(row.plannedYield)} ${row.plannedYieldUnitCode ?? ''}`.trim();
}

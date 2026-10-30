import type { ReceiptCostStatus, UnpricedReceipt } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { SupplierId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useSuppliersQuery, useUnpricedReceiptsQuery } from '../../../data/kitchen-ops-hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure, LensMixPart, LensTone, LensToken } from '../catalogue/lens-bar.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { INVENTORY_VIEW_COSTS_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { receiptCostStatusKey, receiptCostStatusTone } from '../ops-format.ts';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import {
    useListMemory,
    useRememberedFilter,
    useRememberedOpened,
    useRememberedQuery,
} from '../list-memory.ts';

/**
 * `/kitchen/procurement/unpriced-receipts` — the work queue (SUP5, §3.6, §7).
 *
 * On the Catalogue list parts since the Operations handoff: the Lens bar (figures counted over the
 * queue in hand, the two unfinished states among them as filters, the search over supplier and
 * references) and `CatalogueList`, whose one row action — and whose row press — opens the
 * receipt's own page, `unpriced-receipt-screen.tsx`, where the prices are typed.
 *
 * A delivery may be posted with no prices at all: the goods are on the shelf and the paperwork is in
 * the post. This is the list of receipts still waiting on that paperwork, and it exists because the
 * alternative §3.6 refuses is quietly leaving them out of a financial total that then looks
 * complete.
 *
 * ## Two counts, because they are two different jobs
 *
 * `unpricedLineCount` is "type these prices in". `valuationPendingCount` is "the prices are already
 * here and an exchange-rate decision is not this screen's to make" — a row a person **cannot**
 * action, and one they need to tell apart at a glance rather than by opening it. A queue showing one
 * number for both would send people to rows they cannot finish, and the honest explanation is worth
 * a sentence rather than a badge nobody can decode.
 *
 * ## Which headers act, and why the rest do not
 *
 * The queue is a keyset page, so a header control is only honest where the request carries it.
 * Supplier does — `UnpricedReceiptFilter.supplierId` — and filters through it. References, To price
 * and State are plain labels: the filter has no sort parameter and no cost-status parameter, and
 * ordering or narrowing the page in hand would misreport every receipt past it.
 */
export function UnpricedReceiptsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_COSTS_PERMISSION] }}
            testID="kitchen-unpriced-receipts"
        >
            <UnpricedReceipts />
        </Gate>
    );
}

/** The queue holds only unfinished receipts, so its states are the two unfinished ones. */
const QUEUE_STATES: readonly ReceiptCostStatus[] = ['unpriced', 'partial'];
type StateSegmentValue = ReceiptCostStatus | 'all';

/** The whole supplier book, archived included — a receipt outlives the supplier it came from. */
const SUPPLIER_BOOK = { includeArchived: true } as const;

function UnpricedReceipts() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const router = useRouter();

    // Search, filters, page and the receipt last opened survive leaving the queue for a receipt.
    const memory = useListMemory('kitchen.unpriced-receipts');
    const [query, setQuery] = useRememberedQuery(memory);
    const [state, setState] = useRememberedFilter<StateSegmentValue>(memory, 'state', 'all');
    /** The Supplier header's choice, sent with the request — `UnpricedReceiptFilter.supplierId`. */
    const [supplier, setSupplier] = useRememberedFilter<string | null>(memory, 'supplier', null);
    const [lastOpenedId, rememberOpened] = useRememberedOpened(memory);

    const queueFilter = useMemo(
        () => (supplier === null ? {} : { supplierId: SupplierId.unsafe(supplier) }),
        [supplier],
    );
    const queue = useUnpricedReceiptsQuery(queueFilter);
    const supplierBook = useSuppliersQuery(SUPPLIER_BOOK);

    const rows = useMemo(() => queue.data?.items ?? [], [queue.data]);

    const trimmed = query.trim().toLocaleLowerCase();
    // The queue the search leaves, the state aside: what the state figures count.
    const scopeRows = useMemo(
        () =>
            trimmed === ''
                ? rows
                : rows.filter((row) =>
                      [row.supplier?.nameEn, row.documentRef, row.supplierInvoiceRef]
                          .filter((value): value is string => value !== null && value !== undefined)
                          .some((value) => value.toLocaleLowerCase().includes(trimmed)),
                  ),
        [rows, trimmed],
    );
    const filtered = useMemo(
        () => (state === 'all' ? scopeRows : scopeRows.filter((row) => row.costStatus === state)),
        [scopeRows, state],
    );

    const openReceipt = (row: UnpricedReceipt) => {
        rememberOpened(String(row.id));
        router.push(`/kitchen/procurement/unpriced-receipts/${String(row.id)}` as never);
    };

    const receivedText = (row: UnpricedReceipt): string =>
        row.receivedOn === null
            ? '—'
            : formatter.formatDate(row.receivedOn, { dateStyle: 'medium' });

    const columns: readonly ControlledColumn<UnpricedReceipt, CatalogueColumn<UnpricedReceipt>>[] =
        [
            {
                key: 'receivedOn',
                role: 'title',
                label: t('kitchen:ops.unpricedReceipts.columnReceivedOn'),
                width: 140,
                priority: 100,
                value: receivedText,
                sort: (left, right, direction) =>
                    compareText(left.receivedOn ?? '', right.receivedOn ?? '', direction),
                render: (row) => (
                    <Text
                        variant="strong"
                        testID={`kitchen-unpriced-${String(row.id)}-received-on`}
                    >
                        {receivedText(row)}
                    </Text>
                ),
            },
            {
                key: 'supplier',
                label: t('kitchen:ops.unpricedReceipts.columnSupplier'),
                width: 200,
                priority: 90,
                value: (row) => row.supplier?.nameEn ?? t('kitchen:ops.procurement.noSupplier'),
                // Sent with the request: the queue is a keyset page, and matching the rows in hand
                // would hide that supplier's receipts past it. The values are the supplier book,
                // plus any supplier a receipt names that the book did not answer.
                filter: {
                    values: (loaded) => {
                        const seen = new Map<string, string>();
                        for (const entry of supplierBook.data ?? []) {
                            seen.set(String(entry.id), displayName(entry.name, locale).value);
                        }
                        for (const row of loaded) {
                            if (row.supplier !== null && !seen.has(String(row.supplier.id))) {
                                seen.set(String(row.supplier.id), row.supplier.nameEn);
                            }
                        }
                        return [...seen].map(([key, label]) => ({ key, label }));
                    },
                    external: {
                        value: supplier,
                        onChange: setSupplier,
                    },
                },
                render: (row) => (
                    <Text tone="secondary" numberOfLines={1}>
                        {row.supplier?.nameEn ?? t('kitchen:ops.procurement.noSupplier')}
                    </Text>
                ),
            },
            {
                key: 'refs',
                role: 'meta',
                label: t('kitchen:ops.unpricedReceipts.columnRefs'),
                width: 200,
                priority: 60,
                // A plain label: see "Which headers act" above.
                sort: false,
                value: (row) =>
                    `${row.documentRef ?? '—'} · ${
                        row.supplierInvoiceRef ?? t('kitchen:ops.unpricedReceipts.noInvoiceRef')
                    }`,
                render: (row) => (
                    <Text variant="mono" tone="secondary" numberOfLines={1}>
                        {`${row.documentRef ?? '—'} · ${
                            row.supplierInvoiceRef ?? t('kitchen:ops.unpricedReceipts.noInvoiceRef')
                        }`}
                    </Text>
                ),
            },
            {
                key: 'toPrice',
                role: 'metric',
                label: t('kitchen:ops.unpricedReceipts.columnToPrice'),
                width: 150,
                priority: 80,
                sort: false,
                value: (row) =>
                    t('kitchen:ops.unpricedReceipts.linesToPrice', {
                        count: row.unpricedLineCount,
                    }),
                render: (row) => (
                    <View className="min-w-0 flex-row flex-wrap items-center gap-1.5">
                        <Text>
                            {t('kitchen:ops.unpricedReceipts.linesToPrice', {
                                count: row.unpricedLineCount,
                            })}
                        </Text>
                        {row.valuationPendingCount > 0 ? (
                            <Badge
                                tone="warning"
                                testID={`kitchen-unpriced-${String(row.id)}-pending-fx`}
                                label={t('kitchen:ops.unpricedReceipts.pendingFxBadge', {
                                    count: row.valuationPendingCount,
                                })}
                            />
                        ) : null}
                    </View>
                ),
            },
            {
                key: 'state',
                role: 'status',
                label: t('kitchen:ops.unpricedReceipts.columnState'),
                width: 110,
                priority: 85,
                sort: false,
                value: (row) => t(receiptCostStatusKey(row.costStatus)),
                render: (row) => (
                    <Badge
                        tone={receiptCostStatusTone(row.costStatus)}
                        testID={`kitchen-unpriced-${String(row.id)}-status`}
                        label={t(receiptCostStatusKey(row.costStatus))}
                    />
                ),
            },
        ];

    const controls = useColumnControls(filtered, columns, 'kitchen-unpriced-receipts');
    const failure = toFailure(queue.error);
    const unfiltered = trimmed === '' && state === 'all' && supplier === null;

    function clearFilters() {
        setQuery('');
        setState('all');
        setSupplier(null);
    }

    const stateLabel =
        state === 'all'
            ? null
            : t('kitchen:lens.token', {
                  label: t('kitchen:ops.procurement.columnCostStatus'),
                  value: t(receiptCostStatusKey(state)),
              });
    const tokens: readonly LensToken[] =
        stateLabel === null
            ? []
            : [
                  {
                      key: 'state',
                      label: stateLabel,
                      removeLabel: t('kitchen:toolbar.removeFilter', { filter: stateLabel }),
                      onRemove: () => {
                          setState('all');
                      },
                  },
              ];
    const lens =
        failure === null
            ? queueLens(queue.isPending ? null : scopeRows, controls.rows, state, setState, t)
            : { figures: [] };

    return (
        <Cascade space="md" testID="kitchen-unpriced-screen">
            {/* The Lens bar — figures, mix and query row as one object (`lens-bar.tsx`). */}
            <LensBar
                testID="kitchen-unpriced-toolbar"
                label={t('kitchen:lens.label')}
                {...lens}
                search={query}
                onSearchChange={setQuery}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:ops.procurement.searchPlaceholder')}
                tokens={tokens}
                result={
                    queue.isPending
                        ? null
                        : t('kitchen:lens.result', {
                              shown: controls.rows.length,
                              total: rows.length,
                          })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(unfiltered ? {} : { onClear: clearFilters })}
                trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
            />

            {queue.isPending ? (
                <TableSkeleton testID="kitchen-unpriced-loading" partTestID="kitchen-unpriced" />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-unpriced-error"
                    failure={failure}
                    onRetry={() => {
                        void queue.refetch();
                    }}
                    retrying={queue.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-unpriced-empty"
                    title={
                        unfiltered
                            ? t('kitchen:ops.unpricedReceipts.emptyTitle')
                            : t('kitchen:list.filteredEmptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('kitchen:ops.unpricedReceipts.emptyBody')
                            : t('kitchen:ops.procurement.filteredEmptyBody')
                    }
                    // The table — and the Supplier header that narrowed it — is gone in this state,
                    // so the way back has to be here.
                    actions={
                        unfiltered ? undefined : (
                            <Button
                                testID="kitchen-unpriced-clear"
                                variant="secondary"
                                size="sm"
                                label={t('kitchen:toolbar.clearFilters')}
                                onPress={clearFilters}
                            />
                        )
                    }
                />
            ) : (
                <CatalogueList<UnpricedReceipt>
                    testID="kitchen-unpriced-table"
                    label={t('kitchen:ops.unpricedReceipts.title')}
                    columns={controls.columns}
                    rows={controls.rows}
                    rowKey={(row) => String(row.id)}
                    density="sm"
                    highlightedId={lastOpenedId}
                    initialPage={memory.initial.page}
                    onPageChange={(page) => {
                        memory.remember({ page });
                    }}
                    onRowPress={openReceipt}
                    rowActionsLabel={t('kitchen:list.rowActions')}
                    // The one thing to do with a row here is finish its prices.
                    rowActions={(row): readonly MenuItem[] => [
                        {
                            key: 'open',
                            label: t('kitchen:catalogue.edit'),
                            icon: CATALOGUE_ROW_ICONS.edit,
                            testID: `kitchen-unpriced-${String(row.id)}-open`,
                            onSelect: () => {
                                openReceipt(row);
                            },
                        },
                    ]}
                />
            )}
        </Cascade>
    );
}

/**
 * The Lens bar's figures: All receipts and the two unfinished states, which filter, counted over the
 * queue the search leaves; then the lines to price and the lines waiting on a rate in the receipts
 * shown. `null` scope: in flight.
 */
function queueLens(
    scope: readonly UnpricedReceipt[] | null,
    shown: readonly UnpricedReceipt[],
    state: StateSegmentValue,
    setState: (next: StateSegmentValue) => void,
    t: TFunction,
): {
    readonly figures: readonly LensFigure[];
    readonly mix: readonly LensMixPart[];
    readonly mixLabel: string;
} {
    const count = (status: ReceiptCostStatus): number =>
        scope === null ? 0 : scope.filter((row) => row.costStatus === status).length;
    const summed = (pick: (row: UnpricedReceipt) => number): number | null =>
        scope === null ? null : shown.reduce((sum, row) => sum + pick(row), 0);
    const linesToPrice = summed((row) => row.unpricedLineCount);
    return {
        figures: [
            {
                key: 'all',
                label: t('kitchen:lens.allReceipts'),
                value: scope === null ? null : scope.length,
                active: state === 'all',
                onPress: () => {
                    setState('all');
                },
                accessibilityLabel: t('kitchen:lens.allAction'),
            },
            ...QUEUE_STATES.map((status, index): LensFigure => ({
                key: status,
                label: t(receiptCostStatusKey(status)),
                value: scope === null ? null : count(status),
                tone: QUEUE_STATE_TONES[status],
                separated: index === 0,
                active: state === status,
                onPress: () => {
                    setState(status);
                },
                accessibilityLabel: t(QUEUE_STATE_ACTIONS[status]),
            })),
            {
                key: 'linesToPrice',
                label: t('kitchen:ops.unpricedReceipts.columnToPrice'),
                value: linesToPrice,
                tone: 'warning',
                separated: true,
            },
            {
                key: 'pendingFx',
                label: t('kitchen:ops.ledger.statePendingFx'),
                value: summed((row) => row.valuationPendingCount),
                tone: 'info',
            },
        ],
        mix: QUEUE_STATES.map((status) => ({
            key: status,
            value: count(status),
            tone: QUEUE_STATE_TONES[status],
            dimmed: state !== 'all' && state !== status,
        })),
        mixLabel: t('kitchen:lens.unpricedReceiptsMix', {
            unpriced: count('unpriced'),
            partial: count('partial'),
        }),
    };
}

const QUEUE_STATE_TONES: Readonly<Record<ReceiptCostStatus, LensTone>> = {
    unpriced: 'warning',
    partial: 'info',
    complete: 'success',
};

const QUEUE_STATE_ACTIONS: Readonly<Record<ReceiptCostStatus, string>> = {
    unpriced: 'kitchen:lens.unpricedAction',
    partial: 'kitchen:lens.partialAction',
    complete: 'kitchen:lens.allAction',
};

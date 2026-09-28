import type { ReceiptCostStatus, UnpricedReceipt } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    EmptyState,
    ErrorState,
    Stack,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { SupplierId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useSuppliersQuery, useUnpricedReceiptsQuery } from '../../../data/kitchen-ops-hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { INVENTORY_VIEW_COSTS_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { receiptCostStatusKey, receiptCostStatusTone } from '../ops-format.ts';
import { ColumnPicker } from '../catalogue/column-picker.tsx';

/**
 * `/kitchen/procurement/unpriced-receipts` — the work queue (SUP5, §3.6, §7).
 *
 * On the Catalogue list parts since the Operations handoff: stat cards counted over the queue in
 * hand, the toolbar (search over supplier and references, segments for the two unfinished states),
 * and `CatalogueList`, whose one row action — and whose row press — opens the receipt's own page,
 * `unpriced-receipt-screen.tsx`, where the prices are typed.
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

/** The queue holds only unfinished receipts, so its segments are the two unfinished states. */
const STATE_SEGMENTS: readonly ReceiptCostStatus[] = ['unpriced', 'partial'];
type StateSegmentValue = ReceiptCostStatus | 'all';

/** The whole supplier book, archived included — a receipt outlives the supplier it came from. */
const SUPPLIER_BOOK = { includeArchived: true } as const;

function UnpricedReceipts() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const router = useRouter();

    const [query, setQuery] = useState('');
    const [state, setState] = useState<StateSegmentValue>('all');
    /** The Supplier header's choice, sent with the request — `UnpricedReceiptFilter.supplierId`. */
    const [supplier, setSupplier] = useState<string | null>(null);

    const queueFilter = useMemo(
        () => (supplier === null ? {} : { supplierId: SupplierId.unsafe(supplier) }),
        [supplier],
    );
    const queue = useUnpricedReceiptsQuery(queueFilter);
    const supplierBook = useSuppliersQuery(SUPPLIER_BOOK);

    const rows = useMemo(() => queue.data?.items ?? [], [queue.data]);

    const trimmed = query.trim().toLocaleLowerCase();
    const filtered = useMemo(
        () =>
            rows.filter((row) => {
                if (state !== 'all' && row.costStatus !== state) return false;
                if (trimmed === '') return true;
                return [row.supplier?.nameEn, row.documentRef, row.supplierInvoiceRef]
                    .filter((value): value is string => value !== null && value !== undefined)
                    .some((value) => value.toLocaleLowerCase().includes(trimmed));
            }),
        [rows, state, trimmed],
    );

    const openReceipt = (row: UnpricedReceipt) => {
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
                align: 'center',
                role: 'metric',
                label: t('kitchen:ops.unpricedReceipts.columnToPrice'),
                width: 150,
                priority: 80,
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

    const segments: readonly CatalogueStatusSegment<StateSegmentValue>[] = [
        { value: 'all', label: t('kitchen:toolbar.statusAll') },
        ...STATE_SEGMENTS.map((value) => ({ value, label: t(receiptCostStatusKey(value)) })),
    ];

    return (
        <Stack space="md" testID="kitchen-unpriced-screen">
            {queue.isPending || failure !== null ? null : (
                <CatalogueStatCards
                    testID="kitchen-unpriced-stats"
                    cards={queueStatCards(controls.rows, t)}
                />
            )}

            <CatalogueToolbar<StateSegmentValue>
                testID="kitchen-unpriced-toolbar"
                search={query}
                onSearchChange={setQuery}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:ops.procurement.searchPlaceholder')}
                statusLabel={t('kitchen:ops.procurement.columnCostStatus')}
                statusSegments={segments}
                status={state}
                onStatusChange={setState}
            >
                <ColumnPicker {...controls.picker} />
            </CatalogueToolbar>

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
                                onPress={() => {
                                    setQuery('');
                                    setState('all');
                                    setSupplier(null);
                                }}
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

        </Stack>
    );
}

/** Counted over the queue in hand, like the design's CARDS. */
function queueStatCards(
    rows: readonly UnpricedReceipt[],
    t: TFunction,
): readonly CatalogueStatCard[] {
    const linesToPrice = rows.reduce((sum, row) => sum + row.unpricedLineCount, 0);
    const pendingFx = rows.reduce((sum, row) => sum + row.valuationPendingCount, 0);
    return [
        {
            key: 'receipts',
            label: t('kitchen:ops.unpricedReceipts.metrics.receipts'),
            value: String(rows.length),
            unit: t('kitchen:ops.procurement.statReceiptsUnit'),
            caption: t('kitchen:ops.unpricedReceipts.statReceiptsCaption'),
            mark: 'receipt',
            tone: 'brand',
        },
        {
            key: 'linesToPrice',
            label: t('kitchen:ops.unpricedReceipts.columnToPrice'),
            value: String(linesToPrice),
            unit: t('kitchen:ops.ledger.statLinesUnit'),
            caption: t('kitchen:ops.unpricedReceipts.statToPriceCaption'),
            mark: 'coins',
            tone: linesToPrice === 0 ? 'default' : 'warning',
        },
        {
            key: 'pendingFx',
            label: t('kitchen:ops.ledger.statePendingFx'),
            value: String(pendingFx),
            unit: t('kitchen:ops.ledger.statLinesUnit'),
            caption: t('kitchen:ops.unpricedReceipts.statPendingFxCaption'),
            mark: 'clock',
        },
    ];
}

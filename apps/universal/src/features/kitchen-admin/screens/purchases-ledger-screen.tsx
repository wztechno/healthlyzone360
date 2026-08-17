import type { PurchaseLedgerLine } from '@healthy360/api-client/contracts';
import {
    Button,
    EmptyState,
    ErrorState,
    Inline,
    Select,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { StockItemId, SupplierId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    usePurchasesLedgerQuery,
    useStockItemsQuery,
    useSuppliersQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { INVENTORY_VIEW_COSTS_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { OpsPanel } from '../ops-panel.tsx';

/**
 * `/kitchen/purchases-ledger` — the browsable record behind the monthly spend figure (INV1.1).
 *
 * Every goods-receipt line, newest first, with the date, supplier, item, quantity, unit price and
 * line total. Behind `inventory.view_costs_organisation`: this screen *is* the valuation, so a
 * person without the cost permission never reaches it (the card is hidden and the `<Gate>` refuses).
 *
 * Filters are the questions a manager reconciling a month asks — date range, supplier and, since
 * SUP2, stock item — and the page walks forward by cursor. The screen shows what was bought and
 * what it cost, and nothing about how any of it is used: no recipe, no formulation, no derivation
 * passes through the ledger.
 *
 * ## Deep links seed the filters, they do not lock them
 *
 * The supplier page and the stock screen both link in here pre-filtered (`?supplier=`, `?item=`).
 * Those arrive as {@link PurchasesLedgerScreenProps} and seed the filter state **once**, so the
 * person who followed the link lands on the answer they asked for and can then widen it — a filter
 * driven by the URL for the life of the screen would be a page they could not use.
 */

export interface PurchasesLedgerScreenProps {
    /** Pre-select a supplier, from `/kitchen/purchases-ledger?supplier=…`. */
    readonly supplier?: string | undefined;
    /** Pre-select a stock item, from `/kitchen/purchases-ledger?item=…`. */
    readonly item?: string | undefined;
}

export function PurchasesLedgerScreen({ supplier, item }: PurchasesLedgerScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_COSTS_PERMISSION] }}
            testID="kitchen-purchases-ledger"
        >
            <PurchasesLedger supplier={supplier} item={item} />
        </Gate>
    );
}

function PurchasesLedger({ supplier, item }: PurchasesLedgerScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();

    // Seeded from the deep link, then owned by the screen. A parameter that kept overriding the
    // state would make the filter unclearable for anybody who arrived through a link.
    const [supplierId, setSupplierId] = useState<string | null>(supplier ?? null);
    const [stockItemId, setStockItemId] = useState<string | null>(item ?? null);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [cursor, setCursor] = useState<string | undefined>(undefined);

    const suppliers = useSuppliersQuery();
    const stockItems = useStockItemsQuery();
    const filter = useMemo(
        () => ({
            ...(supplierId === null ? {} : { supplierId: SupplierId.unsafe(supplierId) }),
            ...(stockItemId === null ? {} : { stockItemId: StockItemId.unsafe(stockItemId) }),
            ...(from.trim() === '' ? {} : { from: from.trim() }),
            ...(to.trim() === '' ? {} : { to: to.trim() }),
            ...(cursor === undefined ? {} : { cursor }),
        }),
        [supplierId, stockItemId, from, to, cursor],
    );
    const ledger = usePurchasesLedgerQuery(filter);

    // Suppliers are bilingual since SUP1, so the filter labels them in the reader's own language
    // and falls back to the other side rather than offering a blank option.
    const supplierOptions = useMemo(
        () => [
            { value: '', label: t('kitchen:ops.ledger.allSuppliers') },
            ...(suppliers.data ?? []).map((row) => ({
                value: String(row.id),
                label: `${row.code} — ${displayName(row.name, locale).value}`,
            })),
        ],
        [suppliers.data, locale, t],
    );

    // Server order kept — stocked first, then ever-moved, then by name. Re-sorting alphabetically
    // would put two hundred never-received shelves above the dozen this kitchen actually buys.
    const stockItemOptions = useMemo(
        () => [
            { value: '', label: t('kitchen:ops.ledger.allItems') },
            ...(stockItems.data ?? []).map((row) => ({
                value: String(row.id),
                label: `${row.code} — ${row.nameEn}`,
            })),
        ],
        [stockItems.data, t],
    );

    function resetCursor() {
        setCursor(undefined);
    }

    const rows = ledger.data?.items ?? [];
    const nextCursor = ledger.data?.nextCursor ?? null;
    const hasMore = (ledger.data?.hasMore ?? false) && nextCursor !== null;

    const money = (amount: string | null, currency: string | null): string => {
        if (amount === null || currency === null) return '—';
        return `${formatter.formatNumber(Number(amount), {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })} ${currency}`;
    };

    const columns: readonly TableColumn<PurchaseLedgerLine>[] = [
        {
            key: 'receivedAt',
            header: t('kitchen:ops.ledger.columnDate'),
            rowHeader: true,
            render: (row) => (
                <Text testID={`kitchen-ledger-${row.id}-date`}>
                    {row.receivedAt === null
                        ? '—'
                        : formatter.formatDate(row.receivedAt, { dateStyle: 'medium' })}
                </Text>
            ),
        },
        {
            key: 'supplier',
            header: t('kitchen:ops.ledger.columnSupplier'),
            render: (row) => (
                <Text variant="caption" tone="secondary">
                    {row.supplier === null
                        ? t('kitchen:ops.ledger.noSupplier')
                        : row.supplier.nameEn}
                </Text>
            ),
        },
        {
            key: 'item',
            header: t('kitchen:ops.ledger.columnItem'),
            flex: 2,
            render: (row) => (
                <Stack space="none">
                    <Text variant="bodyStrong">{row.itemNameEn ?? row.stockItemId}</Text>
                    <Text variant="caption" tone="secondary">
                        {formatter.formatNumber(Number(row.quantity))}
                    </Text>
                </Stack>
            ),
        },
        {
            key: 'unitPrice',
            header: t('kitchen:ops.ledger.columnUnitPrice'),
            render: (row) => <Text>{money(row.unitPriceAmount, row.costCurrencyCode)}</Text>,
        },
        {
            key: 'lineTotal',
            header: t('kitchen:ops.ledger.columnLineTotal'),
            render: (row) => (
                <Text variant="bodyStrong" testID={`kitchen-ledger-${row.id}-total`}>
                    {money(row.lineTotalAmount, row.costCurrencyCode)}
                </Text>
            ),
        },
    ];

    const failure = toFailure(ledger.error);

    return (
        <Stack space="lg" testID="kitchen-purchases-ledger-screen">
            <OpsPanel
                testID="kitchen-purchases-ledger-panel"
                titleKey="kitchen:ops.ledger.title"
                subtitleKey="kitchen:ops.ledger.subtitle"
                metrics={[]}
                emptyTitleKey="kitchen:ops.ledger.emptyTitle"
                emptyBodyKey="kitchen:ops.ledger.emptyBody"
            >
                <Stack space="md" testID="kitchen-purchases-ledger-content">
                    <Inline space="sm" align="end" wrap>
                        <Select
                            testID="kitchen-ledger-filter-supplier"
                            label={t('kitchen:ops.ledger.filterSupplier')}
                            options={supplierOptions}
                            value={supplierId ?? ''}
                            onChange={(value) => {
                                setSupplierId(value === '' ? null : value);
                                resetCursor();
                            }}
                            searchable
                            className="min-w-[200px] flex-1"
                        />
                        <Select
                            testID="kitchen-ledger-filter-item"
                            label={t('kitchen:ops.ledger.filterItem')}
                            options={stockItemOptions}
                            value={stockItemId ?? ''}
                            onChange={(value) => {
                                setStockItemId(value === '' ? null : value);
                                resetCursor();
                            }}
                            searchable
                            className="min-w-[200px] flex-1"
                        />
                        <TextInputField
                            testID="kitchen-ledger-filter-from"
                            label={t('kitchen:ops.ledger.filterFrom')}
                            value={from}
                            onChangeText={(value) => {
                                setFrom(value);
                                resetCursor();
                            }}
                            placeholder="YYYY-MM-DD"
                            className="w-40"
                        />
                        <TextInputField
                            testID="kitchen-ledger-filter-to"
                            label={t('kitchen:ops.ledger.filterTo')}
                            value={to}
                            onChangeText={(value) => {
                                setTo(value);
                                resetCursor();
                            }}
                            placeholder="YYYY-MM-DD"
                            className="w-40"
                        />
                    </Inline>

                    {ledger.isPending ? (
                        <Stack space="sm" testID="kitchen-purchases-ledger-loading">
                            {Array.from({ length: 4 }, (_, index) => (
                                <Skeleton key={index} heightClassName="h-10" />
                            ))}
                        </Stack>
                    ) : failure !== null ? (
                        <ErrorState
                            testID="kitchen-purchases-ledger-error"
                            failure={failure}
                            onRetry={() => {
                                void ledger.refetch();
                            }}
                            retrying={ledger.isFetching}
                        />
                    ) : rows.length === 0 ? (
                        <EmptyState
                            testID="kitchen-purchases-ledger-empty"
                            title={t('kitchen:ops.ledger.emptyTitle')}
                            body={t('kitchen:ops.ledger.emptyBody')}
                        />
                    ) : (
                        <Stack space="sm">
                            <Table<PurchaseLedgerLine>
                                testID="kitchen-purchases-ledger-table"
                                caption={t('kitchen:ops.ledger.title')}
                                captionHidden
                                columns={columns}
                                rows={rows}
                                rowKey={(row) => row.id}
                            />
                            {hasMore ? (
                                <Inline space="sm" justify="end">
                                    <Button
                                        testID="kitchen-purchases-ledger-next"
                                        variant="secondary"
                                        size="sm"
                                        label={t('kitchen:ops.ledger.nextPage')}
                                        onPress={() => {
                                            setCursor(nextCursor ?? undefined);
                                        }}
                                    />
                                </Inline>
                            ) : null}
                        </Stack>
                    )}
                </Stack>
            </OpsPanel>
        </Stack>
    );
}

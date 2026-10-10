import type {
    PurchaseLedgerLine,
    ReceiptCostStatus,
    SpendSummaryCurrencyTotals,
    SpendSummaryPeriod,
} from '@healthy360/api-client/contracts';
import { RECEIPT_COST_STATUSES } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Cascade,
    DatePickerButton,
    EmptyState,
    ErrorState,
    Inline,
    Stack,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { BadgeTone, MenuItem } from '@healthy360/design-system';
import { StockItemId, SupplierId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    usePurchasesLedgerQuery,
    useSpendSummaryQuery,
    useStockItemsQuery,
    useSuppliersQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CATALOGUE_PAGE_SIZE, CataloguePager } from '../catalogue/catalogue-pager.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import {
    compareAmount,
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { INVENTORY_VIEW_COSTS_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { receiptCostStatusKey } from '../ops-format.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';

/**
 * `/kitchen/purchases-ledger` — the browsable record behind the monthly spend figure (INV1.1), and
 * since SUP6 the weekly and monthly check over the same rows (§3.7, §7).
 *
 * Every goods-receipt line, newest first, with the date, supplier, item, quantity, unit price and
 * line total. Behind `inventory.view_costs_organisation`: this screen *is* the valuation, so a
 * person without the cost permission never reaches it (the card is hidden and the `<Gate>` refuses).
 *
 * Filters are the questions a manager reconciling a month asks — date range, supplier and, since
 * SUP2, stock item — and the pages are walked by cursor. The screen shows what was bought and what
 * it cost, and nothing about how any of it is used: no recipe, no formulation, no derivation passes
 * through the ledger.
 *
 * ## Three modes of one screen, over one set of filters
 *
 * §7: "The purchases ledger gains week/month summary controls and detail filters." They are modes
 * rather than a second screen because they answer the same question at two zoom levels, and a person
 * who has narrowed to one supplier and one month should not have to re-enter that to see it totalled.
 * So the filters are owned by the screen and handed to whichever mode is showing; only the visible
 * mode fetches, because two modes should not cost two requests.
 *
 * A summary period is an **envelope**: the money sits in per-currency rows, and the completeness
 * facts sit on the period itself, because an unpriced line has no currency to belong to. A period
 * with nothing priced in it renders as an Incomplete card with no money rows at all — §3.7's rule
 * that an unpriced line contributes to quantity history and not to money, made visible rather than
 * arithmetic nobody can see.
 *
 * There is deliberately **no total across currencies** anywhere on this screen, and no grand total
 * across periods: this system has no exchange rate (§4.4), and one figure adding two currencies
 * would be a number nobody could reconcile.
 *
 * ## Deep links seed the filters, they do not lock them
 *
 * The supplier page and the stock screen both link in here pre-filtered (`?supplier=`, `?item=`),
 * and `?mode=weekly` opens the summary directly. Those arrive as {@link PurchasesLedgerScreenProps}
 * and seed the state **once**, so the person who followed the link lands on the answer they asked
 * for and can then widen it — a filter driven by the URL for the life of the screen would be a page
 * they could not use.
 *
 * ## On the Catalogue list (Operations handoff)
 *
 * The cost note sits first, then stat cards counted over the lines in hand, then one toolbar row:
 * the search, the three read-as modes, and at its end the received-between window. Supplier, item
 * and price state are filtered from their column headers, which send them with the request, so the
 * row carries no picker that repeats a header. The search box narrows only the page in hand,
 * because the endpoint has no text search. Read-only: View is the one row action, and it opens the
 * record window.
 *
 * ## Pages, like every other admin table
 *
 * The endpoint is a keyset: it hands back the next page's cursor and whether there is one, and never
 * a total. So the pager is built from the cursors seen — page one has none, and each page that
 * loads with more behind it adds the cursor of the next — and offers every page reached plus the
 * next one. It grows as the reader walks forward, any page seen is one press away, and it claims no
 * total the server never gave. Any filter starts it again at page one.
 */

/** Detail walks the lines; weekly and monthly total them. */
const LEDGER_MODES = ['detail', 'weekly', 'monthly'] as const;
type LedgerMode = (typeof LEDGER_MODES)[number];

function isLedgerMode(value: string | undefined): value is LedgerMode {
    return value !== undefined && (LEDGER_MODES as readonly string[]).includes(value);
}

export interface PurchasesLedgerScreenProps {
    /** Pre-select a supplier, from `/kitchen/purchases-ledger?supplier=…`. */
    readonly supplier?: string | undefined;
    /** Pre-select a stock item, from `/kitchen/purchases-ledger?item=…`. */
    readonly item?: string | undefined;
    /** Open straight into a summary, from `?mode=weekly` or `?mode=monthly`. */
    readonly mode?: string | undefined;
}

export function PurchasesLedgerScreen({ supplier, item, mode }: PurchasesLedgerScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_COSTS_PERMISSION] }}
            testID="kitchen-purchases-ledger"
        >
            <PurchasesLedger supplier={supplier} item={item} mode={mode} />
        </Gate>
    );
}

function PurchasesLedger({ supplier, item, mode }: PurchasesLedgerScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();

    // Seeded from the deep link, then owned by the screen. A parameter that kept overriding the
    // state would make the filter unclearable for anybody who arrived through a link.
    const [supplierId, setSupplierId] = useState<string | null>(supplier ?? null);
    const [stockItemId, setStockItemId] = useState<string | null>(item ?? null);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [costStatus, setCostStatus] = useState<ReceiptCostStatus | null>(null);
    const [activeMode, setActiveMode] = useState<LedgerMode>(isLedgerMode(mode) ? mode : 'detail');
    // `cursors[n - 1]` opens page n: page one has none, and each loaded page with more behind it
    // adds the next page's. See "Pages, like every other admin table" above.
    const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
    const [page, setPage] = useState(1);
    const cursor = cursors[page - 1];
    const [expandedCharges, setExpandedCharges] = useState<readonly string[]>([]);
    const [query, setQuery] = useState('');
    const [viewing, setViewing] = useState<PurchaseLedgerLine | null>(null);

    const suppliers = useSuppliersQuery();
    const stockItems = useStockItemsQuery();

    // The filters both modes share. `costStatus` is deliberately not among them: narrowing the
    // detail list to the receipts still waiting on an invoice is a work question, while hiding them
    // from a summary would produce exactly the apparently-complete total §3.7 refuses.
    const shared = useMemo(
        () => ({
            ...(supplierId === null ? {} : { supplierId: SupplierId.unsafe(supplierId) }),
            ...(stockItemId === null ? {} : { stockItemId: StockItemId.unsafe(stockItemId) }),
            ...(from.trim() === '' ? {} : { from: from.trim() }),
            ...(to.trim() === '' ? {} : { to: to.trim() }),
        }),
        [supplierId, stockItemId, from, to],
    );

    const ledgerFilter = useMemo(
        () => ({
            ...shared,
            ...(costStatus === null ? {} : { costStatus }),
            ...(cursor === undefined ? {} : { cursor }),
            limit: CATALOGUE_PAGE_SIZE,
        }),
        [shared, costStatus, cursor],
    );

    const summaryFilter = useMemo(
        () => ({
            ...shared,
            groupBy: activeMode === 'weekly' ? ('week' as const) : ('month' as const),
        }),
        [shared, activeMode],
    );

    const isDetail = activeMode === 'detail';
    const ledger = usePurchasesLedgerQuery(ledgerFilter, isDetail);
    const summary = useSpendSummaryQuery(summaryFilter, !isDetail);

    // Only the label of a deep-linked item that is not on the page in hand comes from here.
    const stockItemNameById = useMemo(() => {
        const map = new Map<string, string>();
        for (const row of stockItems.data ?? []) map.set(String(row.id), row.nameEn);
        return map;
    }, [stockItems.data]);

    function resetCursor() {
        setCursors([undefined]);
        setPage(1);
        setViewing(null);
    }

    const pageRows = useMemo(() => ledger.data?.items ?? [], [ledger.data]);
    const nextCursor = ledger.data?.nextCursor ?? null;
    const hasMore = (ledger.data?.hasMore ?? false) && nextCursor !== null;

    // The page in hand says there is another: remember where it starts, once. Adjusted during
    // render — this component's own state, derived from what it fetched — rather than in an effect,
    // which would paint the pager a page short first. The query keeps no previous data, so
    // `ledger.data` is always this page's own, and once added the condition no longer holds.
    if (hasMore && nextCursor !== null && cursors.length === page) {
        setCursors([...cursors, nextCursor]);
    }

    // The endpoint has no text search, so the search box narrows the page in hand and says so in
    // its placeholder; the filters below are the server-side questions.
    const trimmed = query.trim().toLocaleLowerCase();
    const rows = useMemo(
        () =>
            trimmed === ''
                ? pageRows
                : pageRows.filter((row) =>
                      [row.itemNameEn, row.itemCode, row.supplier?.nameEn, row.documentRef]
                          .filter((value): value is string => value !== null && value !== undefined)
                          .some((value) => value.toLocaleLowerCase().includes(trimmed)),
                  ),
        [pageRows, trimmed],
    );

    const money = (amount: string | null, currency: string | null): string => {
        if (amount === null || currency === null) return '—';
        return `${formatter.formatNumber(Number(amount), {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })} ${currency}`;
    };

    const dateText = (row: PurchaseLedgerLine): string =>
        row.receivedOn !== null
            ? formatter.formatDate(row.receivedOn, { dateStyle: 'medium' })
            : row.receivedAt === null
              ? '—'
              : formatter.formatDate(row.receivedAt, { dateStyle: 'medium' });

    const itemTitle = (row: PurchaseLedgerLine): string => row.itemNameEn ?? row.stockItemId;

    const columns: readonly ControlledColumn<
        PurchaseLedgerLine,
        CatalogueColumn<PurchaseLedgerLine>
    >[] = [
        {
            key: 'item',
            role: 'title',
            label: t('kitchen:ops.ledger.columnItem'),
            width: 240,
            priority: 100,
            value: itemTitle,
            sort: (left, right, direction) =>
                compareText(itemTitle(left), itemTitle(right), direction),
            /*
             * Sent with the request, like Supplier: the page is one of many. Offered from the items
             * on the page in hand rather than the whole library — five hundred shelves is not a
             * menu — plus the chosen one when it is not among them, which is how a `?item=` link
             * from the stock screen stays clearable.
             */
            filter: {
                values: (loaded) => {
                    const items = new Map<string, string>();
                    for (const row of loaded) items.set(String(row.stockItemId), itemTitle(row));
                    if (stockItemId !== null && !items.has(stockItemId)) {
                        items.set(stockItemId, stockItemNameById.get(stockItemId) ?? stockItemId);
                    }
                    return [...items].map(([key, label]) => ({ key, label }));
                },
                external: {
                    value: stockItemId,
                    onChange: (next) => {
                        setStockItemId(next);
                        resetCursor();
                    },
                },
            },
            // The name alone: the code is the name's slug, and the price has its own column.
            render: (row) => (
                <Text variant="strong" numberOfLines={1}>
                    {itemTitle(row)}
                </Text>
            ),
        },
        {
            key: 'supplier',
            label: t('kitchen:ops.ledger.columnSupplier'),
            width: 180,
            priority: 80,
            value: (row) => row.supplier?.nameEn ?? t('kitchen:ops.ledger.noSupplier'),
            // The ledger is cursor-paged, so the supplier travels with the request. Every
            // supplier in the book is offered, not only those on the loaded page.
            filter: {
                values: () =>
                    (suppliers.data ?? []).map((entry) => ({
                        key: String(entry.id),
                        label: displayName(entry.name, locale).value,
                    })),
                external: {
                    value: supplierId,
                    onChange: (next) => {
                        setSupplierId(next);
                        resetCursor();
                    },
                },
            },
            render: (row) => (
                <Text tone="secondary" numberOfLines={1}>
                    {row.supplier === null
                        ? t('kitchen:ops.ledger.noSupplier')
                        : row.supplier.nameEn}
                </Text>
            ),
        },
        {
            key: 'receivedAt',
            label: t('kitchen:ops.ledger.columnDate'),
            width: 110,
            priority: 90,
            value: dateText,
            sort: (left, right, direction) =>
                compareText(
                    left.receivedOn ?? left.receivedAt ?? '',
                    right.receivedOn ?? right.receivedAt ?? '',
                    direction,
                ),
            render: (row) => (
                <Text variant="mono" testID={`kitchen-ledger-${row.id}-date`}>
                    {dateText(row)}
                </Text>
            ),
        },
        {
            key: 'quantity',
            role: 'metric',
            label: t('kitchen:ops.ledger.columnQuantity'),
            width: 100,
            priority: 70,
            value: (row) => formatter.formatNumber(Number(row.quantity)),
            sort: (left, right, direction) =>
                compareNumber(Number(left.quantity), Number(right.quantity), direction),
            render: (row) => (
                <Text variant="mono">{formatter.formatNumber(Number(row.quantity))}</Text>
            ),
        },
        {
            key: 'unitPrice',
            role: 'metric',
            label: t('kitchen:ops.ledger.columnUnitPrice'),
            width: 120,
            priority: 72,
            value: (row) => money(row.unitPriceAmount, row.costCurrencyCode),
            sort: (left, right, direction) =>
                compareAmount(left.unitPriceAmount, right.unitPriceAmount, direction),
            render: (row) => (
                <Text variant="mono" testID={`kitchen-ledger-${row.id}-unit-price`}>
                    {money(row.unitPriceAmount, row.costCurrencyCode)}
                </Text>
            ),
        },
        {
            key: 'lineTotal',
            role: 'metric',
            label: t('kitchen:ops.ledger.columnLineTotal'),
            width: 120,
            priority: 85,
            value: (row) => money(row.lineTotalAmount, row.costCurrencyCode),
            sort: (left, right, direction) =>
                compareAmount(left.lineTotalAmount, right.lineTotalAmount, direction),
            render: (row) => (
                <Text variant="mono" testID={`kitchen-ledger-${row.id}-total`}>
                    {money(row.lineTotalAmount, row.costCurrencyCode)}
                </Text>
            ),
        },
        {
            key: 'state',
            role: 'status',
            label: t('kitchen:ops.ledger.columnState'),
            width: 110,
            priority: 75,
            value: (row) => t(LINE_STATE_KEYS[ledgerLineState(row)]),
            /*
             * Filtered by the receipt's costing state, because that is the question the endpoint
             * can answer (`cost_status`) and the page is one of many. The badge is the *line's*
             * state, so the values are named in the receipt's words — No prices · Some prices ·
             * Priced — rather than the badge's, and "Some prices" honestly shows priced and unpriced
             * lines side by side. Narrowing the loaded page by the line state instead would misreport
             * every page after it.
             */
            filter: {
                values: () =>
                    RECEIPT_COST_STATUSES.map((status) => ({
                        key: status,
                        label: t(receiptCostStatusKey(status)),
                    })),
                external: {
                    value: costStatus,
                    onChange: (next) => {
                        setCostStatus(
                            RECEIPT_COST_STATUSES.find((status) => status === next) ?? null,
                        );
                        resetCursor();
                    },
                },
            },
            render: (row) => (
                <Badge
                    testID={`kitchen-ledger-${row.id}-state`}
                    tone={LINE_STATE_TONES[ledgerLineState(row)]}
                    label={t(LINE_STATE_KEYS[ledgerLineState(row)])}
                />
            ),
        },
    ];

    // Seven columns, one over the catalogue's six: a price without its quantity, or a quantity
    // without its price, is half of a purchase line.
    const controls = useColumnControls(rows, columns, 'kitchen-purchases-ledger', {
        picker: { max: 7 },
    });

    const failure = toFailure(isDetail ? ledger.error : summary.error);
    const pending = isDetail ? ledger.isPending : summary.isPending;
    const periods = summary.data?.periods ?? [];

    function toggleCharges(key: string) {
        setExpandedCharges((current) =>
            current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
        );
    }

    const modeSegments: readonly CatalogueStatusSegment<LedgerMode>[] = [
        { value: 'detail', label: t('kitchen:ops.ledger.modeDetail') },
        { value: 'weekly', label: t('kitchen:ops.ledger.modeWeekly') },
        { value: 'monthly', label: t('kitchen:ops.ledger.modeMonthly') },
    ];

    const viewingState = viewing === null ? null : ledgerLineState(viewing);

    if (viewing !== null && viewingState !== null) {
        return (
            <RecordViewPage
                testID="kitchen-purchases-ledger-view"
                onBack={() => {
                    setViewing(null);
                }}
                title={itemTitle(viewing)}
                kind={t('kitchen:ops.ledger.viewKind')}
                status={{
                    label: t(LINE_STATE_KEYS[viewingState]),
                    tone: LINE_STATE_TONES[viewingState],
                }}
                {...(viewingState === 'priced'
                    ? {}
                    : {
                          note: t(
                              viewingState === 'pendingFx'
                                  ? 'kitchen:ops.ledger.viewPendingFxNote'
                                  : 'kitchen:ops.ledger.viewUnpricedNote',
                          ),
                      })}
                fields={[
                    {
                        key: 'supplier',
                        label: t('kitchen:ops.ledger.columnSupplier'),
                        value: viewing.supplier?.nameEn ?? t('kitchen:ops.ledger.noSupplier'),
                    },
                    {
                        key: 'date',
                        label: t('kitchen:ops.ledger.columnDate'),
                        value: dateText(viewing),
                        mono: true,
                    },
                    {
                        key: 'documentRef',
                        label: t('kitchen:ops.procurement.fieldDocumentRef'),
                        value: viewing.documentRef ?? '—',
                        mono: true,
                    },
                    {
                        key: 'quantity',
                        label: t('kitchen:ops.ledger.columnQuantity'),
                        value: formatter.formatNumber(Number(viewing.quantity)),
                        mono: true,
                    },
                    {
                        key: 'unitPrice',
                        label: t('kitchen:ops.ledger.columnUnitPrice'),
                        value: money(viewing.unitPriceAmount, viewing.costCurrencyCode),
                        mono: true,
                    },
                    {
                        key: 'lineTotal',
                        label: t('kitchen:ops.ledger.columnLineTotal'),
                        value: money(viewing.lineTotalAmount, viewing.costCurrencyCode),
                        mono: true,
                    },
                ]}
                footNote={t('kitchen:ops.ledger.viewFoot')}
            />
        );
    }

    return (
        <Cascade space="md" testID="kitchen-purchases-ledger-screen">
            {/* §5: the ledger is the valuation, and the reader should know why they can see it. */}
            <Callout
                testID="kitchen-purchases-ledger-cost-note"
                role="note"
                tone="danger"
                title={t('kitchen:ops.ledger.costNoteTitle')}
                body={t('kitchen:ops.ledger.costNoteBody')}
            />

            {isDetail && failure === null ? (
                <CatalogueStatCards
                    testID="kitchen-purchases-ledger-stats"
                    cards={ledgerStatCards(controls.rows, t)}
                    pending={pending}
                />
            ) : null}

            <CatalogueToolbar<LedgerMode>
                testID="kitchen-ledger-toolbar"
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:ops.ledger.searchPlaceholder')}
                statusLabel={t('kitchen:ops.ledger.modeLabel')}
                statusSegments={modeSegments}
                status={activeMode}
                onStatusChange={(next) => {
                    setActiveMode(next);
                    setViewing(null);
                }}
            >
                {/*
                 * The received-between window, at the row's end: the one filter with no column to
                 * live on. Two days with "to" between, either bound open, and each picker keeps the
                 * other honest — From cannot pass To, nor To precede From.
                 */}
                <DatePickerButton
                    testID="kitchen-ledger-filter-from"
                    label={t('kitchen:ops.ledger.filterFrom')}
                    value={from}
                    max={to === '' ? undefined : to}
                    placeholder={t('kitchen:ops.ledger.fromPlaceholder')}
                    onChange={(value) => {
                        setFrom(value);
                        resetCursor();
                    }}
                    onClear={() => {
                        setFrom('');
                        resetCursor();
                    }}
                />
                <Text variant="caption" tone="secondary" aria-hidden>
                    {t('kitchen:ops.requirements.windowTo')}
                </Text>
                <DatePickerButton
                    testID="kitchen-ledger-filter-to"
                    label={t('kitchen:ops.ledger.filterTo')}
                    value={to}
                    min={from === '' ? undefined : from}
                    placeholder={t('kitchen:ops.ledger.toPlaceholder')}
                    onChange={(value) => {
                        setTo(value);
                        resetCursor();
                    }}
                    onClear={() => {
                        setTo('');
                        resetCursor();
                    }}
                />
                <ColumnPicker {...controls.picker} />
            </CatalogueToolbar>

            {pending ? (
                <TableSkeleton
                    testID="kitchen-purchases-ledger-loading"
                    partTestID="kitchen-purchases-ledger"
                />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-purchases-ledger-error"
                    failure={failure}
                    onRetry={() => {
                        void (isDetail ? ledger.refetch() : summary.refetch());
                    }}
                    retrying={isDetail ? ledger.isFetching : summary.isFetching}
                />
            ) : isDetail ? (
                controls.rows.length === 0 ? (
                    <EmptyState
                        testID="kitchen-purchases-ledger-empty"
                        title={t('kitchen:ops.ledger.emptyTitle')}
                        body={t('kitchen:ops.ledger.emptyBody')}
                    />
                ) : (
                    <Stack space="sm">
                        <CatalogueList<PurchaseLedgerLine>
                            testID="kitchen-purchases-ledger-table"
                            label={t('kitchen:ops.ledger.title')}
                            columns={controls.columns}
                            rows={controls.rows}
                            rowKey={(row) => row.id}
                            density="sm"
                            onRowPress={setViewing}
                            rowActionsLabel={t('kitchen:list.rowActions')}
                            // View only: there is nothing to write from a ledger.
                            rowActions={(row): readonly MenuItem[] => [
                                {
                                    key: 'view',
                                    label: t('kitchen:list.view'),
                                    icon: CATALOGUE_ROW_ICONS.view,
                                    testID: `kitchen-ledger-${row.id}-view`,
                                    onSelect: () => {
                                        setViewing(row);
                                    },
                                },
                            ]}
                        />
                        <CataloguePager
                            testID="kitchen-purchases-ledger-pagination"
                            page={page}
                            totalPages={cursors.length}
                            onPageChange={(next) => {
                                setPage(next);
                                setViewing(null);
                            }}
                            label={t('kitchen:catalogue.pagerLabel')}
                        />
                    </Stack>
                )
            ) : periods.length === 0 ? (
                <EmptyState
                    testID="kitchen-purchases-ledger-summary-empty"
                    title={t('kitchen:ops.ledger.summaryEmptyTitle')}
                    body={t('kitchen:ops.ledger.summaryEmptyBody')}
                />
            ) : (
                <Stack space="md" testID="kitchen-purchases-ledger-summary">
                    {summary.data === undefined ? null : (
                        <Text
                            variant="caption"
                            tone="secondary"
                            testID="kitchen-ledger-summary-range"
                        >
                            {t('kitchen:ops.ledger.summaryRange', {
                                from: summary.data.from,
                                to: summary.data.to,
                            })}
                        </Text>
                    )}
                    {periods.map((period) => (
                        <PeriodCard
                            key={period.period}
                            period={period}
                            expanded={expandedCharges}
                            onToggleCharges={toggleCharges}
                        />
                    ))}
                </Stack>
            )}
        </Cascade>
    );
}

/**
 * A line's money state, in the design's three words.
 *
 * Pending FX is checked first: such a line *has* a recorded price, and calling it unpriced would
 * send somebody to type in a figure that already exists.
 */
type LedgerLineState = 'unpriced' | 'pendingFx' | 'priced';

function ledgerLineState(row: PurchaseLedgerLine): LedgerLineState {
    if (row.valuationPendingFx) return 'pendingFx';
    if (row.lineTotalAmount === null || row.unitPriceAmount === null) return 'unpriced';
    return 'priced';
}

const LINE_STATE_KEYS: Readonly<Record<LedgerLineState, string>> = {
    unpriced: 'kitchen:ops.ledger.stateUnpriced',
    pendingFx: 'kitchen:ops.ledger.statePendingFx',
    priced: 'kitchen:ops.ledger.statePriced',
};

const LINE_STATE_TONES: Readonly<Record<LedgerLineState, BadgeTone>> = {
    unpriced: 'warning',
    pendingFx: 'info',
    priced: 'success',
};

/** Counted over the lines in hand, like the design's CARDS. */
function ledgerStatCards(
    rows: readonly PurchaseLedgerLine[],
    t: TFunction,
): readonly CatalogueStatCard[] {
    const count = (state: LedgerLineState) =>
        rows.filter((row) => ledgerLineState(row) === state).length;
    const unpriced = count('unpriced');
    const pendingFx = count('pendingFx');
    return [
        {
            key: 'unpriced',
            label: t('kitchen:ops.ledger.stateUnpriced'),
            value: String(unpriced),
            unit: t('kitchen:ops.ledger.statLinesUnit'),
            caption: t('kitchen:ops.ledger.statUnpricedCaption'),
            mark: 'coins',
            tone: unpriced === 0 ? 'default' : 'warning',
        },
        {
            key: 'pendingFx',
            label: t('kitchen:ops.ledger.statePendingFx'),
            value: String(pendingFx),
            unit: t('kitchen:ops.ledger.statLinesUnit'),
            caption: t('kitchen:ops.ledger.statPendingFxCaption'),
            mark: 'clock',
        },
        {
            key: 'priced',
            label: t('kitchen:ops.ledger.statePriced'),
            value: String(count('priced')),
            unit: t('kitchen:ops.ledger.statLinesUnit'),
            caption: t('kitchen:ops.ledger.statPricedCaption'),
            mark: 'circleCheck',
        },
    ];
}

/**
 * One ISO week or calendar month.
 *
 * The Complete/Incomplete badge is a fact about the **period**, not about a currency row, and it sits
 * in the header for that reason: what is missing from the figures below is missing from all of them.
 * A period with nothing priced renders its badge and its counts and no money at all, which is the
 * honest rendering of "nothing here has been costed yet" — a zero would read as a quiet month.
 */
function PeriodCard({
    period,
    expanded,
    onToggleCharges,
}: {
    readonly period: SpendSummaryPeriod;
    readonly expanded: readonly string[];
    readonly onToggleCharges: (key: string) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View
            testID={`kitchen-ledger-period-${period.period}`}
            className="gap-3 rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-card"
        >
            <Inline space="sm" align="center" wrap>
                <Stack space="none" className="min-w-0 flex-1">
                    <Text
                        variant="bodyStrong"
                        testID={`kitchen-ledger-period-${period.period}-label`}
                    >
                        {period.period}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:ops.ledger.periodDates', {
                            from: formatter.formatDate(period.periodStart, { dateStyle: 'medium' }),
                            to: formatter.formatDate(period.periodEnd, { dateStyle: 'medium' }),
                        })}
                    </Text>
                </Stack>
                <Badge
                    testID={`kitchen-ledger-period-${period.period}-state`}
                    tone={period.isComplete ? 'success' : 'warning'}
                    icon={period.isComplete ? 'check' : 'warning'}
                    label={t(
                        period.isComplete
                            ? 'kitchen:ops.ledger.completeBadge'
                            : 'kitchen:ops.ledger.incompleteBadge',
                    )}
                />
            </Inline>

            {period.unpricedLineCount > 0 ? (
                <Text
                    variant="caption"
                    tone="secondary"
                    testID={`kitchen-ledger-period-${period.period}-unpriced`}
                >
                    {t('kitchen:ops.ledger.unpricedLines', { count: period.unpricedLineCount })}
                </Text>
            ) : null}

            {period.valuationPendingLineCount > 0 ? (
                <Text
                    variant="caption"
                    tone="secondary"
                    testID={`kitchen-ledger-period-${period.period}-pending-fx`}
                >
                    {t('kitchen:ops.ledger.pendingFxNote', {
                        count: period.valuationPendingLineCount,
                    })}
                </Text>
            ) : null}

            {period.totalsByCurrency.length === 0 ? (
                <Text tone="secondary" testID={`kitchen-ledger-period-${period.period}-no-money`}>
                    {t('kitchen:ops.ledger.noPricedDeliveries')}
                </Text>
            ) : (
                <Stack space="sm">
                    {period.totalsByCurrency.map((totals) => (
                        <CurrencyRow
                            key={totals.currencyCode}
                            periodLabel={period.period}
                            totals={totals}
                            expanded={expanded.includes(`${period.period}|${totals.currencyCode}`)}
                            onToggleCharges={() =>
                                onToggleCharges(`${period.period}|${totals.currencyCode}`)
                            }
                        />
                    ))}
                </Stack>
            )}
        </View>
    );
}

/**
 * One currency inside one period.
 *
 * Item subtotal and invoice total are two named figures side by side, never one: §3.7 is explicit
 * that tax and delivery must not be mislabelled as an ingredient's purchase price, and an invoice
 * total nobody recorded reads as an em dash rather than as zero. The charges are collapsed by
 * default — they are the detail behind the difference between the two figures, and a manager who
 * wants to know why the invoice exceeds the goods opens them.
 */
function CurrencyRow({
    periodLabel,
    totals,
    expanded,
    onToggleCharges,
}: {
    readonly periodLabel: string;
    readonly totals: SpendSummaryCurrencyTotals;
    readonly expanded: boolean;
    readonly onToggleCharges: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const testID = `kitchen-ledger-period-${periodLabel}-${totals.currencyCode}`;

    const money = (amount: string | null): string =>
        amount === null
            ? '—'
            : `${formatter.formatNumber(Number(amount), {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
              })} ${totals.currencyCode}`;

    return (
        <View testID={testID} className="gap-2 rounded-lg bg-surface-sunken p-3">
            <Inline space="md" wrap>
                <Stack space="none" className="min-w-[140px]">
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:ops.ledger.summarySubtotal')}
                    </Text>
                    <Text variant="bodyStrong" testID={`${testID}-subtotal`}>
                        {money(totals.itemSubtotal)}
                    </Text>
                </Stack>
                <Stack space="none" className="min-w-[140px]">
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:ops.ledger.summaryInvoiceTotal')}
                    </Text>
                    <Text variant="bodyStrong" testID={`${testID}-invoice-total`}>
                        {money(totals.invoiceTotal)}
                    </Text>
                </Stack>
                <Stack space="none" className="min-w-[140px]">
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:ops.ledger.summaryLines')}
                    </Text>
                    <Text testID={`${testID}-lines`}>
                        {formatter.formatNumber(totals.receivedLineCount)}
                    </Text>
                </Stack>
            </Inline>

            <Inline space="sm" wrap>
                <Button
                    testID={`${testID}-charges-toggle`}
                    variant="ghost"
                    size="sm"
                    label={t(
                        expanded
                            ? 'kitchen:ops.ledger.hideCharges'
                            : 'kitchen:ops.ledger.showCharges',
                    )}
                    onPress={onToggleCharges}
                />
            </Inline>

            {expanded ? (
                <Stack space="xs" testID={`${testID}-charges`}>
                    <Text variant="caption" tone="secondary">
                        {`${t('kitchen:ops.ledger.chargeDiscount')}: ${money(totals.discountTotal)}`}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {`${t('kitchen:ops.ledger.chargeTax')}: ${money(totals.taxTotal)}`}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {`${t('kitchen:ops.ledger.chargeDelivery')}: ${money(totals.deliveryTotal)}`}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {`${t('kitchen:ops.ledger.chargeOther')}: ${money(totals.otherChargesTotal)}`}
                    </Text>
                </Stack>
            ) : null}
        </View>
    );
}

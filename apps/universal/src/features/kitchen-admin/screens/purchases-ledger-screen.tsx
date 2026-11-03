import type {
    PurchaseLedgerLine,
    ReceiptCostStatus,
    SpendSummaryCurrencyTotals,
    SpendSummaryPeriod,
} from '@healthy360/api-client/contracts';
import { RECEIPT_COST_STATUSES } from '@healthy360/api-client/contracts';
import {
    Badge,
    Cascade,
    DatePickerButton,
    EmptyState,
    ErrorState,
    InfoTip,
    Inline,
    SegmentedControl,
    Stack,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { BadgeTone, MenuItem } from '@healthy360/design-system';
import { StockItemId, SupplierId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
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
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure, LensMixPart, LensToken } from '../catalogue/lens-bar.tsx';
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
import { ReceiptOpenOrder, ReceiptOrderRef } from '../receipt-order-ref.tsx';
import {
    useListMemory,
    useRememberedFilter,
    useRememberedOpened,
    useRememberedPageNumber,
    useRememberedQuery,
    useRestoredPageFallback,
} from '../list-memory.ts';
import { useViewedRecord } from '../use-viewed-record.ts';

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
 * facts sit on the period itself, because an unpriced line has no currency to belong to. So a
 * summary is one table with a row per period, each money cell holding one line per currency, and
 * the status cell naming what is missing — unpriced lines, prices waiting on a rate — as badges. A
 * period with nothing priced in it shows "Nothing priced" and no money at all — §3.7's rule that an
 * unpriced line contributes to quantity history and not to money, made visible rather than
 * arithmetic nobody can see. The charges behind the invoiced figure are columns the reader adds from
 * the column picker, not on by default.
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
 * One Lens bar over the list: figures counted over the page in hand — or, in a summary, the periods
 * by completeness, which filter the table — then the read-as mode, the received-between window and
 * (in detail only, since a period has no item to search for) the search on its query row. Supplier, item
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

/** The ledger's first page: no cursor opens it. */
const FIRST_PAGE_CURSORS: readonly (string | undefined)[] = [undefined];

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
    /** `?view=` — the line whose page is open (`use-viewed-record.ts`). */
    readonly view?: string | undefined;
}

export function PurchasesLedgerScreen({ supplier, item, mode, view }: PurchasesLedgerScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_COSTS_PERMISSION] }}
            testID="kitchen-purchases-ledger"
        >
            <PurchasesLedger supplier={supplier} item={item} mode={mode} view={view} />
        </Gate>
    );
}

function PurchasesLedger({ supplier, item, mode, view }: PurchasesLedgerScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();

    // Where the ledger was left — filters, mode, page, the line last opened — unless a deep link
    // opened it: then the link is the question, and the ledger starts from it alone.
    const linked = supplier !== undefined || item !== undefined || mode !== undefined;
    const memory = useListMemory('kitchen.purchases-ledger', { fresh: linked });

    // Seeded from the deep link, then owned by the screen. A parameter that kept overriding the
    // state would make the filter unclearable for anybody who arrived through a link.
    const [supplierId, setSupplierId] = useRememberedFilter<string | null>(
        memory,
        'supplierId',
        supplier ?? null,
    );
    const [stockItemId, setStockItemId] = useRememberedFilter<string | null>(
        memory,
        'stockItemId',
        item ?? null,
    );
    const [from, setFrom] = useRememberedFilter(memory, 'from', '');
    const [to, setTo] = useRememberedFilter(memory, 'to', '');
    const [costStatus, setCostStatus] = useRememberedFilter<ReceiptCostStatus | null>(
        memory,
        'costStatus',
        null,
    );
    const [activeMode, setActiveMode] = useRememberedFilter<LedgerMode>(
        memory,
        'mode',
        isLedgerMode(mode) ? mode : 'detail',
    );
    // `cursors[n - 1]` opens page n: page one has none, and each loaded page with more behind it
    // adds the next page's. See "Pages, like every other admin table" above.
    const [cursors, setCursors] = useRememberedFilter<readonly (string | undefined)[]>(
        memory,
        'cursors',
        FIRST_PAGE_CURSORS,
    );
    const [page, setPage] = useRememberedPageNumber(memory);
    const cursor = cursors[page - 1];
    // A summary's own narrowing: which periods, by completeness. Client-side — the summary is
    // never paged — so it is not sent and does not touch the detail filters.
    const [periodStatus, setPeriodStatus] = useRememberedFilter<PeriodStatus | null>(
        memory,
        'periodStatus',
        null,
    );
    const [query, setQuery] = useRememberedQuery(memory);
    const [lastOpenedId, rememberOpened] = useRememberedOpened(memory);
    const openView = (row: PurchaseLedgerLine) => {
        rememberOpened(row.id);
        setViewing(row);
    };

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
    // A remembered cursor the book no longer honours starts the book again.
    useRestoredPageFallback(memory, page, ledger.isError, () => {
        setCursors(FIRST_PAGE_CURSORS);
        setPage(1);
    });
    const summary = useSpendSummaryQuery(summaryFilter, !isDetail);

    // Only the label of a deep-linked item that is not on the page in hand comes from here.
    const stockItemNameById = useMemo(() => {
        const map = new Map<string, string>();
        for (const row of stockItems.data ?? []) map.set(String(row.id), row.nameEn);
        return map;
    }, [stockItems.data]);

    function resetCursor() {
        setCursors(FIRST_PAGE_CURSORS);
        setPage(1);
        setViewing(null);
    }

    const pageRows = useMemo(() => ledger.data?.items ?? [], [ledger.data]);
    // The open line is an address, `?view=`, so Back and a refresh keep it open.
    const { viewing, setViewing } = useViewedRecord(
        view,
        pageRows,
        (row) => row.id,
        ledger.isSuccess && !ledger.isFetching,
    );
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
                      [
                          row.itemNameEn,
                          row.itemCode,
                          row.supplier?.nameEn,
                          row.documentRef,
                          row.purchaseOrderNumber,
                      ]
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
            // What arrived, off the pack (ingredient barcodes): the supplier lot, read for a recall.
            key: 'lot',
            label: t('kitchen:barcodes.columnLot'),
            width: 120,
            priority: 40,
            value: (row) => row.supplierLot ?? '',
            sort: (left, right, direction) =>
                compareText(left.supplierLot ?? '', right.supplierLot ?? '', direction),
            render: (row) => (
                <Text variant="mono" testID={`kitchen-ledger-${row.id}-lot`}>
                    {row.supplierLot ?? '—'}
                </Text>
            ),
        },
        {
            key: 'order',
            label: t('kitchen:ops.procurement.columnOrder'),
            width: 120,
            priority: 45,
            value: (row) => row.purchaseOrderNumber ?? '—',
            sort: (left, right, direction) =>
                compareText(
                    left.purchaseOrderNumber ?? '',
                    right.purchaseOrderNumber ?? '',
                    direction,
                ),
            render: (row) => (
                <ReceiptOrderRef
                    orderId={row.purchaseOrderId}
                    orderNumber={row.purchaseOrderNumber}
                    testID={`kitchen-ledger-${row.id}-order`}
                />
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

    const controls = useColumnControls(rows, columns, 'kitchen-purchases-ledger', {
        picker: { defaults: LINE_DEFAULT_COLUMNS },
    });

    const failure = toFailure(isDetail ? ledger.error : summary.error);
    const pending = isDetail ? ledger.isPending : summary.isPending;
    const periods = useMemo(() => summary.data?.periods ?? [], [summary.data]);
    const shownPeriods = useMemo(
        () =>
            periodStatus === null
                ? periods
                : periods.filter((entry) => entry.isComplete === (periodStatus === 'complete')),
        [periods, periodStatus],
    );
    const summaryControls = useColumnControls(
        shownPeriods,
        periodColumns(activeMode === 'weekly' ? 'weekly' : 'monthly', periods, t, formatter),
        'kitchen-purchases-ledger-summary',
        { picker: { defaults: PERIOD_DEFAULT_COLUMNS } },
    );

    const modeOptions: readonly { readonly value: LedgerMode; readonly label: string }[] = [
        { value: 'detail', label: t('kitchen:ops.ledger.modeDetail') },
        { value: 'weekly', label: t('kitchen:ops.ledger.modeWeekly') },
        { value: 'monthly', label: t('kitchen:ops.ledger.modeMonthly') },
    ];

    // The mode is a scope, not a filter: Clear leaves it. Each mode counts only the narrowing it
    // draws, so Clear never appears for a filter the reader cannot see.
    const filtered =
        (isDetail ? query.trim() !== '' || costStatus !== null : periodStatus !== null) ||
        supplierId !== null ||
        stockItemId !== null ||
        from !== '' ||
        to !== '';

    function clearFilters() {
        setQuery('');
        setCostStatus(null);
        setPeriodStatus(null);
        setSupplierId(null);
        setStockItemId(null);
        setFrom('');
        setTo('');
        resetCursor();
    }

    function clearCostStatus() {
        setCostStatus(null);
        resetCursor();
    }

    const costStatusLabel =
        costStatus === null
            ? null
            : t('kitchen:lens.token', {
                  label: t('kitchen:ops.ledger.columnState'),
                  value: t(receiptCostStatusKey(costStatus)),
              });
    const tokens: readonly LensToken[] =
        costStatusLabel === null || !isDetail
            ? []
            : [
                  {
                      key: 'costStatus',
                      label: costStatusLabel,
                      removeLabel: t('kitchen:toolbar.removeFilter', { filter: costStatusLabel }),
                      onRemove: clearCostStatus,
                  },
              ];
    const lens =
        failure !== null
            ? { figures: [] }
            : isDetail
              ? ledgerLens(pending ? null : pageRows, costStatus === null, clearCostStatus, t)
              : periodLens(
                    pending ? null : periods,
                    activeMode === 'weekly' ? 'weekly' : 'monthly',
                    periodStatus,
                    setPeriodStatus,
                    t,
                );

    // The window the summary actually read, in the date buttons while the reader has set none —
    // the server defaults it, and the reader should see which months they are looking at.
    const summaryBound = (bound: 'from' | 'to'): string | null =>
        isDetail || summary.data === undefined
            ? null
            : formatter.formatDate(summary.data[bound], { dateStyle: 'medium', timeZone: 'UTC' });

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
                {...(viewing.purchaseOrderId === null
                    ? {}
                    : {
                          statusContent: (
                              <ReceiptOpenOrder
                                  orderId={viewing.purchaseOrderId}
                                  testID="kitchen-ledger-view-open-order"
                              />
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
                        key: 'order',
                        label: t('kitchen:ops.procurement.columnOrder'),
                        value: viewing.purchaseOrderNumber ?? '—',
                        mono: true,
                    },
                    {
                        key: 'quantity',
                        label: t('kitchen:ops.ledger.columnQuantity'),
                        value: formatter.formatNumber(Number(viewing.quantity)),
                        mono: true,
                    },
                    {
                        key: 'lot',
                        label: t('kitchen:barcodes.columnLot'),
                        value: viewing.supplierLot ?? '—',
                        mono: true,
                    },
                    {
                        key: 'expiresOn',
                        label: t('kitchen:barcodes.expiresLabel'),
                        value:
                            viewing.expiresOn === null
                                ? '—'
                                : formatter.formatDate(viewing.expiresOn, {
                                      dateStyle: 'medium',
                                      timeZone: 'UTC',
                                  }),
                    },
                    {
                        key: 'bestBeforeOn',
                        label: t('kitchen:barcodes.bestBeforeLabel'),
                        value:
                            viewing.bestBeforeOn === null
                                ? '—'
                                : formatter.formatDate(viewing.bestBeforeOn, {
                                      dateStyle: 'medium',
                                      timeZone: 'UTC',
                                  }),
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
            {/*
             * The Lens bar — figures, mix and query row as one object over the list
             * (`lens-bar.tsx`). The figures count the detail page in hand; a summary has none.
             */}
            <LensBar
                testID="kitchen-ledger-toolbar"
                label={t('kitchen:lens.label')}
                {...lens}
                /* A period has no item or supplier to find, so only the lines are searched. */
                {...(isDetail
                    ? {
                          search: query,
                          onSearchChange: (next: string) => {
                              setQuery(next);
                              setViewing(null);
                          },
                          searchLabel: t('kitchen:toolbar.searchLabel'),
                          searchPlaceholder: t('kitchen:ops.ledger.searchPlaceholder'),
                      }
                    : {})}
                tokens={tokens}
                result={
                    pending
                        ? null
                        : t('kitchen:lens.result', {
                              shown: isDetail ? controls.rows.length : shownPeriods.length,
                              total: isDetail ? pageRows.length : periods.length,
                          })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(filtered ? { onClear: clearFilters } : {})}
                /*
                 * The read-as mode — three buttons, every choice in sight — then the
                 * received-between window: the one filter with no column to live on. Two days with
                 * "to" between, either bound open, and each picker keeps the other honest — From
                 * cannot pass To, nor To precede From.
                 */
                scope={
                    <>
                        <Text variant="body" tone="secondary" aria-hidden>
                            {t('kitchen:ops.ledger.modeLabel')}
                        </Text>
                        <SegmentedControl<LedgerMode>
                            testID="kitchen-ledger-mode"
                            label={t('kitchen:ops.ledger.modeLabel')}
                            value={activeMode}
                            onChange={(next) => {
                                setActiveMode(next);
                                setViewing(null);
                            }}
                            items={modeOptions.map((option) => ({
                                ...option,
                                testID: `kitchen-ledger-mode-${option.value}`,
                            }))}
                        />
                        <View aria-hidden className="mx-1 h-5 w-px bg-brand-100" />
                        <View className="flex-row items-center gap-tight">
                            <DatePickerButton
                                testID="kitchen-ledger-filter-from"
                                label={t('kitchen:ops.ledger.filterFrom')}
                                value={from}
                                max={to === '' ? undefined : to}
                                placeholder={
                                    summaryBound('from') ?? t('kitchen:ops.ledger.fromPlaceholder')
                                }
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
                                placeholder={
                                    summaryBound('to') ?? t('kitchen:ops.ledger.toPlaceholder')
                                }
                                onChange={(value) => {
                                    setTo(value);
                                    resetCursor();
                                }}
                                onClear={() => {
                                    setTo('');
                                    resetCursor();
                                }}
                            />
                        </View>
                    </>
                }
                trailing={(narrow) => (
                    <ColumnPicker
                        {...(isDetail ? controls.picker : summaryControls.picker)}
                        compact={narrow}
                    />
                )}
            />

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
                            highlightedId={lastOpenedId}
                            onRowPress={openView}
                            rowActionsLabel={t('kitchen:list.rowActions')}
                            // View only: there is nothing to write from a ledger.
                            rowActions={(row): readonly MenuItem[] => [
                                {
                                    key: 'view',
                                    label: t('kitchen:list.view'),
                                    icon: CATALOGUE_ROW_ICONS.view,
                                    testID: `kitchen-ledger-${row.id}-view`,
                                    onSelect: () => {
                                        openView(row);
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
                />
            ) : (
                <CatalogueList<SpendSummaryPeriod>
                    testID="kitchen-purchases-ledger-summary"
                    label={t(
                        activeMode === 'weekly'
                            ? 'kitchen:ops.ledger.summaryWeeklyLabel'
                            : 'kitchen:ops.ledger.summaryMonthlyLabel',
                    )}
                    columns={summaryControls.columns}
                    rows={summaryControls.rows}
                    rowKey={(row) => row.period}
                    rowActionsLabel={t('kitchen:list.rowActions')}
                />
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

/**
 * The Lens bar's figures: All lines, then the three money states, counted over the page in hand —
 * the endpoint gives no total. The states are the lines', not the receipt cost status the State
 * header filters by, so they are read-only; All clears that filter. `null` rows: in flight.
 */
function ledgerLens(
    rows: readonly PurchaseLedgerLine[] | null,
    allActive: boolean,
    onAll: () => void,
    t: TFunction,
): {
    readonly figures: readonly LensFigure[];
    readonly mix: readonly LensMixPart[];
    readonly mixLabel: string;
} {
    const count = (state: LedgerLineState): number =>
        rows === null ? 0 : rows.filter((row) => ledgerLineState(row) === state).length;
    const counted = (state: LedgerLineState): number | null =>
        rows === null ? null : count(state);
    return {
        figures: [
            {
                key: 'all',
                label: t('kitchen:lens.allLines'),
                value: rows === null ? null : rows.length,
                active: allActive,
                onPress: onAll,
                accessibilityLabel: t('kitchen:lens.allAction'),
            },
            {
                key: 'unpriced',
                label: t('kitchen:ops.ledger.stateUnpriced'),
                value: counted('unpriced'),
                tone: 'warning',
                separated: true,
            },
            {
                key: 'pendingFx',
                label: t('kitchen:ops.ledger.statePendingFx'),
                value: counted('pendingFx'),
                tone: 'info',
            },
            {
                key: 'priced',
                label: t('kitchen:ops.ledger.statePriced'),
                value: counted('priced'),
                tone: 'success',
            },
        ],
        mix: [
            { key: 'unpriced', value: count('unpriced'), tone: 'warning' },
            { key: 'pendingFx', value: count('pendingFx'), tone: 'info' },
            { key: 'priced', value: count('priced'), tone: 'success' },
        ],
        mixLabel: t('kitchen:lens.ledgerMix', {
            unpriced: count('unpriced'),
            pendingFx: count('pendingFx'),
            priced: count('priced'),
        }),
    };
}

/** A summary's narrowing by completeness — the Lens figures' filter. */
type PeriodStatus = 'complete' | 'incomplete';

/**
 * What a first visit draws: the six-column cap, with quantity, price and total kept together — a
 * price without its quantity is half of a purchase line. The received date waits in the column
 * picker; the toolbar's From and Until already narrow by it.
 */
const LINE_DEFAULT_COLUMNS = ['item', 'supplier', 'quantity', 'unitPrice', 'lineTotal', 'state'];

/** What a first visit draws. The four charges wait in the column picker, as the cards' toggle did. */
const PERIOD_DEFAULT_COLUMNS = ['period', 'status', 'lines', 'goods', 'invoiced'];

type Formatter = ReturnType<typeof useFormatter>;

function formatMoney(formatter: Formatter, amount: string | null, currency: string): string {
    if (amount === null) return '—';
    return `${formatter.formatNumber(Number(amount), {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })} ${currency}`;
}

/**
 * Every line received in the period. A priced line — pending FX included, since it carries a total —
 * is counted in its currency's row; an unpriced one has no currency and is counted on the period.
 */
function periodLineCount(period: SpendSummaryPeriod): number {
    return (
        period.unpricedLineCount +
        period.totalsByCurrency.reduce((sum, totals) => sum + totals.receivedLineCount, 0)
    );
}

/**
 * The Lens bar's figures over a summary: the periods, then how many are complete and incomplete —
 * each a filter on the table — then the unpriced lines behind the incomplete ones. Counted over
 * every period the server answered, not the filtered table. `null` periods: in flight.
 */
function periodLens(
    periods: readonly SpendSummaryPeriod[] | null,
    mode: 'weekly' | 'monthly',
    status: PeriodStatus | null,
    onStatus: (next: PeriodStatus | null) => void,
    t: TFunction,
): {
    readonly figures: readonly LensFigure[];
    readonly mix: readonly LensMixPart[];
    readonly mixLabel: string;
} {
    const count = (complete: boolean): number =>
        periods === null ? 0 : periods.filter((entry) => entry.isComplete === complete).length;
    const counted = (complete: boolean): number | null =>
        periods === null ? null : count(complete);
    const unpriced =
        periods === null ? null : periods.reduce((sum, entry) => sum + entry.unpricedLineCount, 0);
    // A figure narrows while it has something to show, and pressing the one in force lets go.
    const filterOn = (next: PeriodStatus, complete: boolean) =>
        count(complete) === 0 && status !== next
            ? {}
            : {
                  onPress: () => {
                      onStatus(status === next ? null : next);
                  },
              };

    return {
        figures: [
            {
                key: 'all',
                label: t(mode === 'weekly' ? 'kitchen:lens.allWeeks' : 'kitchen:lens.allMonths'),
                value: periods === null ? null : periods.length,
                active: status === null,
                onPress: () => {
                    onStatus(null);
                },
                accessibilityLabel: t('kitchen:lens.allPeriodsAction'),
            },
            {
                key: 'complete',
                label: t('kitchen:ops.ledger.completeBadge'),
                value: counted(true),
                tone: 'success',
                separated: true,
                active: status === 'complete',
                ...filterOn('complete', true),
                accessibilityLabel: t('kitchen:lens.completePeriodsAction'),
            },
            {
                key: 'incomplete',
                label: t('kitchen:ops.ledger.incompleteBadge'),
                value: counted(false),
                tone: 'warning',
                active: status === 'incomplete',
                ...filterOn('incomplete', false),
                accessibilityLabel: t('kitchen:lens.incompletePeriodsAction'),
            },
            {
                key: 'unpriced',
                label: t('kitchen:lens.unpricedLines'),
                value: unpriced,
                tone: 'warning',
                separated: true,
            },
        ],
        mix: [
            {
                key: 'complete',
                value: count(true),
                tone: 'success',
                dimmed: status === 'incomplete',
            },
            {
                key: 'incomplete',
                value: count(false),
                tone: 'warning',
                dimmed: status === 'complete',
            },
        ],
        mixLabel: t('kitchen:lens.periodsMix', { complete: count(true), incomplete: count(false) }),
    };
}

/**
 * The summary table's columns: a row per period, every money cell one line per currency.
 *
 * Goods carries a bar — the period's subtotal against the largest one in the same currency across
 * the answer — so a quiet month and a busy one read apart before a figure is read. Per currency,
 * because there is no exchange rate to put two on one scale (§4.4).
 */
function periodColumns(
    mode: 'weekly' | 'monthly',
    periods: readonly SpendSummaryPeriod[],
    t: TFunction,
    formatter: Formatter,
): readonly ControlledColumn<SpendSummaryPeriod, CatalogueColumn<SpendSummaryPeriod>>[] {
    const largest = new Map<string, number>();
    for (const entry of periods) {
        for (const totals of entry.totalsByCurrency) {
            const amount = Number(totals.itemSubtotal);
            largest.set(
                totals.currencyCode,
                Math.max(largest.get(totals.currencyCode) ?? 0, amount),
            );
        }
    }

    const dayMonth = (day: string): string =>
        formatter.formatDate(day, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const label = (entry: SpendSummaryPeriod): string =>
        mode === 'weekly'
            ? t('kitchen:ops.ledger.weekLabel', {
                  week: Number(entry.period.slice(entry.period.indexOf('W') + 1)),
              })
            : formatter.formatDate(entry.periodStart, {
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'UTC',
              });
    const moneyText = (
        entry: SpendSummaryPeriod,
        amount: (totals: SpendSummaryCurrencyTotals) => string | null,
    ): string =>
        entry.totalsByCurrency
            .map((totals) => formatMoney(formatter, amount(totals), totals.currencyCode))
            .join(' · ');

    const charge = (
        key: string,
        labelKey: string,
        amount: (totals: SpendSummaryCurrencyTotals) => string,
    ): ControlledColumn<SpendSummaryPeriod, CatalogueColumn<SpendSummaryPeriod>> => ({
        key,
        label: t(labelKey),
        width: 120,
        priority: 30,
        value: (entry) => moneyText(entry, amount),
        render: (entry) => <MoneyLines period={entry} amount={amount} suffix={key} />,
    });

    return [
        {
            key: 'period',
            role: 'title',
            label: t(
                mode === 'weekly'
                    ? 'kitchen:ops.ledger.columnWeek'
                    : 'kitchen:ops.ledger.columnMonth',
            ),
            width: 170,
            priority: 100,
            value: label,
            sort: (left, right, direction) => compareText(left.period, right.period, direction),
            render: (entry) => (
                <View testID={`kitchen-ledger-period-${entry.period}`} className="min-w-0">
                    <Text
                        variant="strong"
                        numberOfLines={1}
                        testID={`kitchen-ledger-period-${entry.period}-label`}
                    >
                        {label(entry)}
                    </Text>
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                        {t('kitchen:ops.ledger.periodDates', {
                            from: dayMonth(entry.periodStart),
                            to: dayMonth(entry.periodEnd),
                        })}
                    </Text>
                </View>
            ),
        },
        {
            key: 'status',
            role: 'status',
            label: t('kitchen:ops.ledger.columnStatus'),
            width: 190,
            priority: 90,
            value: (entry) =>
                t(
                    entry.isComplete
                        ? 'kitchen:ops.ledger.completeBadge'
                        : 'kitchen:ops.ledger.incompleteBadge',
                ),
            render: (entry) => <PeriodStatusCell period={entry} />,
        },
        {
            key: 'lines',
            label: t('kitchen:ops.ledger.summaryLines'),
            width: 80,
            priority: 60,
            value: (entry) => formatter.formatNumber(periodLineCount(entry)),
            sort: (left, right, direction) =>
                compareNumber(periodLineCount(left), periodLineCount(right), direction),
            render: (entry) => (
                <Text variant="mono" testID={`kitchen-ledger-period-${entry.period}-lines`}>
                    {formatter.formatNumber(periodLineCount(entry))}
                </Text>
            ),
        },
        {
            key: 'goods',
            role: 'metric',
            label: t('kitchen:ops.ledger.summarySubtotal'),
            width: 260,
            priority: 85,
            value: (entry) =>
                entry.totalsByCurrency.length === 0
                    ? t('kitchen:ops.ledger.nothingPriced')
                    : moneyText(entry, (totals) => totals.itemSubtotal),
            sort: (left, right, direction) =>
                compareAmount(
                    left.totalsByCurrency[0]?.itemSubtotal ?? null,
                    right.totalsByCurrency[0]?.itemSubtotal ?? null,
                    direction,
                ),
            render: (entry) => <GoodsCell period={entry} largest={largest} />,
        },
        {
            key: 'invoiced',
            label: t('kitchen:ops.ledger.summaryInvoiceTotal'),
            width: 150,
            priority: 80,
            value: (entry) => moneyText(entry, (totals) => totals.invoiceTotal),
            render: (entry) => (
                <MoneyLines
                    period={entry}
                    amount={(totals) => totals.invoiceTotal}
                    suffix="invoice-total"
                />
            ),
        },
        charge('discount', 'kitchen:ops.ledger.chargeDiscount', (totals) => totals.discountTotal),
        charge('tax', 'kitchen:ops.ledger.chargeTax', (totals) => totals.taxTotal),
        charge('delivery', 'kitchen:ops.ledger.chargeDelivery', (totals) => totals.deliveryTotal),
        charge('other', 'kitchen:ops.ledger.chargeOther', (totals) => totals.otherChargesTotal),
    ];
}

/**
 * Complete, or what keeps the period from it — unpriced lines and prices waiting on a rate are two
 * different jobs and get a badge each. Why the figures are short sits behind the (i), never as a
 * line on the row.
 */
function PeriodStatusCell({ period }: { readonly period: SpendSummaryPeriod }) {
    const { t } = useTranslation();
    const testID = `kitchen-ledger-period-${period.period}`;

    if (period.isComplete) {
        return (
            <Badge
                testID={`${testID}-state`}
                tone="success"
                icon="check"
                label={t('kitchen:ops.ledger.completeBadge')}
            />
        );
    }

    const unpriced = period.unpricedLineCount;
    const pendingFx = period.valuationPendingLineCount;
    const reasons = [
        period.totalsByCurrency.length === 0
            ? t('kitchen:ops.ledger.statusNothingPriced')
            : unpriced > 0
              ? t('kitchen:ops.ledger.statusUnpricedInfo', { count: unpriced })
              : null,
        pendingFx > 0 ? t('kitchen:ops.ledger.statusPendingFxInfo', { count: pendingFx }) : null,
    ].filter((reason): reason is string => reason !== null);

    return (
        <Inline space="xs" align="center" wrap={false} testID={`${testID}-state`}>
            {unpriced > 0 ? (
                <Badge
                    testID={`${testID}-unpriced`}
                    tone="warning"
                    icon="warning"
                    label={t('kitchen:ops.ledger.unpricedBadge', { count: unpriced })}
                />
            ) : null}
            {pendingFx > 0 ? (
                <Badge
                    testID={`${testID}-pending-fx`}
                    tone="info"
                    label={t('kitchen:ops.ledger.pendingFxBadge', { count: pendingFx })}
                />
            ) : null}
            {unpriced === 0 && pendingFx === 0 ? (
                <Badge
                    tone="warning"
                    icon="warning"
                    label={t('kitchen:ops.ledger.incompleteBadge')}
                />
            ) : null}
            {reasons.length === 0 ? null : (
                <InfoTip
                    testID={`${testID}-info`}
                    label={t('kitchen:ops.ledger.incompleteBadge')}
                    text={reasons.join(' ')}
                />
            )}
        </Inline>
    );
}

/** One figure per currency, stacked; a period with no money at all draws a dash. */
function MoneyLines({
    period,
    amount,
    suffix,
}: {
    readonly period: SpendSummaryPeriod;
    readonly amount: (totals: SpendSummaryCurrencyTotals) => string | null;
    readonly suffix: string;
}) {
    const formatter = useFormatter();
    if (period.totalsByCurrency.length === 0) {
        return <Text tone="secondary">—</Text>;
    }
    return (
        <Stack space="none">
            {period.totalsByCurrency.map((totals) => (
                <Text
                    key={totals.currencyCode}
                    variant="mono"
                    testID={`kitchen-ledger-period-${period.period}-${totals.currencyCode}-${suffix}`}
                >
                    {formatMoney(formatter, amount(totals), totals.currencyCode)}
                </Text>
            ))}
        </Stack>
    );
}

/**
 * The goods subtotal per currency, each with its bar. Nothing priced is said in words rather than
 * drawn as a zero, which would read as a quiet month.
 */
function GoodsCell({
    period,
    largest,
}: {
    readonly period: SpendSummaryPeriod;
    readonly largest: ReadonlyMap<string, number>;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    if (period.totalsByCurrency.length === 0) {
        return (
            <Text tone="secondary" testID={`kitchen-ledger-period-${period.period}-no-money`}>
                {t('kitchen:ops.ledger.nothingPriced')}
            </Text>
        );
    }

    return (
        <Stack space="none">
            {period.totalsByCurrency.map((totals) => {
                const top = largest.get(totals.currencyCode) ?? 0;
                const share =
                    top <= 0
                        ? 0
                        : Math.max(2, Math.round((Number(totals.itemSubtotal) / top) * 100));
                return (
                    <Inline key={totals.currencyCode} space="sm" align="center" wrap={false}>
                        <Text
                            variant="mono"
                            className="font-semibold"
                            testID={`kitchen-ledger-period-${period.period}-${totals.currencyCode}-subtotal`}
                        >
                            {formatMoney(formatter, totals.itemSubtotal, totals.currencyCode)}
                        </Text>
                        <View
                            aria-hidden
                            className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-sunken"
                        >
                            <View
                                className="h-1.5 rounded-full bg-surface-brand"
                                style={{ width: `${share}%` }}
                            />
                        </View>
                    </Inline>
                );
            })}
        </Stack>
    );
}

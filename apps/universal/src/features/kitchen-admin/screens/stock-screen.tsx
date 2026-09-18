import type { ItemLatestPurchase, StockItem, StockLevel } from '@healthy360/api-client/contracts';
import {
    Badge,
    Callout,
    EmptyState,
    ErrorState,
    FormGrid,
    FormSection,
    SegmentedControl,
    Select,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { BadgeTone, MenuItem } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useItemLatestPurchasesQuery,
    useRecordStockAdjustmentMutation,
    useRecordStockWasteMutation,
    useSetStockThresholdMutation,
    useStockItemsQuery,
    useStockLevelsQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn, SortDirection } from '../catalogue/use-column-controls.tsx';
import { EditorFrame } from '../editor-frame.tsx';
import {
    INVENTORY_MANAGE_PERMISSION,
    INVENTORY_VIEW_COSTS_PERMISSION,
    INVENTORY_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { parseQuantity } from '../format.ts';
import { isOutOfStock, stockItemLabel, stockItemRowTestId } from '../ops-format.ts';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';

/**
 * `/kitchen/stock` — the inventory ledger (O1, reworked by INV2.0, rebuilt on the Operations
 * handoff's list and `edStock` editor).
 *
 * ```
 * ┌ SHOWN ┐ ┌ LOW STOCK ┐ ┌ OUT OF STOCK ┐ ┌ IN STOCK ┐
 * [ ⌕ search ]  [ Ingredients | Resale ]  [ All | Low | Out | In stock ]
 * ITEM            QUANTITY  UNIT  REORDER AT / PAR  LAST PURCHASE           STATUS  ◉ ✎ ⟲
 * Showing 1–25 of 248                                                         [ ‹ 1 2 › ]
 * ```
 *
 * ## Nothing is declared here any more
 *
 * A stock item is **derived**: one per ingredient in the library, one per product the kitchen buys
 * in to resell. There is no "add item" — a shelf follows an ingredient or a product. What this
 * screen does is what a kitchen actually does to stock: count it, waste it, and set the point it
 * reorders at.
 *
 * ## Two books, one list
 *
 * **Ingredients** and **Resale** are the same table split by `backing`, so they are a kind switch
 * on one list rather than two tables. The branch's levels are joined onto each item on
 * `stockItemId`: an item with no level row has nothing on the shelf here, which reads `Empty`.
 *
 * ## Every movement is a ledger entry
 *
 * The editor never writes a level. Increase and decrease post an adjustment, Waste posts a waste
 * movement, and the threshold is its own write. `recordStockAdjustment`, `recordStockWaste` and
 * `setStockThreshold` all create the level row if none exists yet, so the editor opens on any item.
 *
 * ## The last-purchase column is a second read, joined here
 *
 * It cannot ride on the stock rows: those come from Inventory, and Inventory may not import
 * Procurement. So the price is a separate Procurement read over the **visible page's** ids — the
 * whole library in one query string is what the edge refused with a `414`. Three cells, kept three:
 * **Hidden** without the cost permission, an actual price with it, and *never bought*.
 */
export function StockScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-stock"
        >
            <Stock />
        </Gate>
    );
}

/** Client-side pages over a book the stock read answers whole. Capped for the `414` reason above. */
const PAGE_SIZE = 25;

type Kind = 'ingredients' | 'products';
type LevelSegment = 'all' | 'low' | 'out' | 'ok';
type LevelState = Exclude<LevelSegment, 'all'>;

/** One item with this branch's level joined on, and the level state derived once. */
interface StockRow {
    readonly item: StockItem;
    readonly level: StockLevel | null;
    readonly state: LevelState;
}

function levelState(level: StockLevel | null): LevelState {
    if (level === null || isOutOfStock(level.quantity)) return 'out';
    return level.isLow ? 'low' : 'ok';
}

const STATE_TONE: Readonly<Record<LevelState, BadgeTone>> = {
    out: 'danger',
    low: 'warning',
    ok: 'success',
};

const STATE_LABEL: Readonly<Record<LevelState, string>> = {
    out: 'kitchen:ops.stock.emptyShelf',
    low: 'kitchen:ops.stock.lowBadge',
    ok: 'kitchen:ops.stock.inStockBadge',
};

/** The Status column's filter values, in the order the badge escalates. */
const LEVEL_STATES: readonly LevelState[] = ['ok', 'low', 'out'];

/** Decimal strings in `direction`, an unset figure last both ways. */
function compareDecimal(
    left: string | null,
    right: string | null,
    direction: SortDirection,
): number {
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    return compareNumber(Number(left), Number(right), direction);
}

function Stock() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);
    const canViewCosts = useCan(INVENTORY_VIEW_COSTS_PERMISSION);

    const items = useStockItemsQuery();
    const levels = useStockLevelsQuery();

    const [query, setQuery] = useState('');
    const [kind, setKind] = useState<Kind>('ingredients');
    const [segment, setSegment] = useState<LevelSegment>('all');
    /**
     * The page, remembered against the header filters it was chosen under — so narrowing a column
     * lands on page one without an effect. `null` is "page one, whatever the filters".
     */
    const [paging, setPaging] = useState<{ readonly key: object | null; readonly page: number }>({
        key: null,
        page: 1,
    });
    const [viewing, setViewing] = useState<StockRow | null>(null);
    const [editing, setEditing] = useState<StockRow | null>(null);

    const levelByItem = useMemo(() => {
        const byItem = new Map<string, StockLevel>();
        for (const level of levels.data ?? []) byItem.set(String(level.stockItemId), level);
        return byItem;
    }, [levels.data]);

    // The server's ranking — stocked first, then ever-moved, then by name — survives because
    // `filter` preserves order.
    const bookRows = useMemo(
        () =>
            (items.data ?? [])
                .filter((item) =>
                    kind === 'ingredients'
                        ? item.backing === 'ingredient'
                        : item.backing === 'product',
                )
                .map((item): StockRow => {
                    const level = levelByItem.get(String(item.id)) ?? null;
                    return { item, level, state: levelState(level) };
                }),
        [items.data, kind, levelByItem],
    );

    const trimmed = query.trim().toLowerCase();
    const filteredRows = useMemo(
        () =>
            bookRows.filter((row) => {
                if (
                    trimmed !== '' &&
                    !row.item.nameEn.toLowerCase().includes(trimmed) &&
                    !row.item.code.toLowerCase().includes(trimmed)
                ) {
                    return false;
                }
                return segment === 'all' || row.state === segment;
            }),
        [bookRows, trimmed, segment],
    );

    const resetPage = () => {
        setPaging({ key: null, page: 1 });
        setViewing(null);
    };

    const quantityText = (row: StockRow) =>
        row.level === null
            ? formatter.formatNumber(0)
            : formatter.formatNumber(Number(row.level.quantity));

    const reorderText = (row: StockRow) => {
        const threshold = row.level?.reorderThreshold ?? null;
        const par = row.level?.parLevel ?? null;
        if (threshold === null && par === null) return t('kitchen:ops.stock.noThreshold');
        return t('kitchen:ops.stock.reorderPar', {
            threshold:
                threshold === null
                    ? t('kitchen:list.noValue')
                    : formatter.formatNumber(Number(threshold)),
            par: par === null ? t('kitchen:list.noValue') : formatter.formatNumber(Number(par)),
        });
    };

    const columns: readonly ControlledColumn<StockRow, CatalogueColumn<StockRow>>[] = [
        {
            key: 'item',
            role: 'title',
            label: t('kitchen:ops.stock.columnItem'),
            width: 220,
            priority: 100,
            value: (row) => row.item.nameEn,
            sort: (left, right, direction) =>
                compareText(left.item.nameEn, right.item.nameEn, direction),
            render: (row) => {
                const testID = stockItemRowTestId(String(row.item.id));
                return (
                    <View testID={testID} className="min-w-0 flex-col">
                        <Text variant="strong" numberOfLines={1} testID={`${testID}-name`}>
                            {row.item.nameEn}
                        </Text>
                        <Text variant="caption" tone="secondary" numberOfLines={1}>
                            {row.item.code}
                        </Text>
                    </View>
                );
            },
        },
        {
            key: 'quantity',
            role: 'metric',
            label: t('kitchen:ops.stock.columnQuantity'),
            width: 110,
            priority: 90,
            align: 'end',
            value: quantityText,
            sort: (left, right, direction) =>
                compareNumber(
                    Number(left.level?.quantity ?? 0),
                    Number(right.level?.quantity ?? 0),
                    direction,
                ),
            render: (row) => (
                <Text
                    variant="mono"
                    tone={row.state === 'ok' ? 'primary' : 'danger'}
                    testID={`${stockItemRowTestId(String(row.item.id))}-quantity`}
                >
                    {quantityText(row)}
                </Text>
            ),
        },
        {
            key: 'unit',
            role: 'meta',
            label: t('kitchen:ops.stock.columnUnit'),
            width: 80,
            priority: 60,
            value: (row) => row.item.unitCode,
            // The units this book actually counts in. A code is its own label — it is what the
            // cell prints.
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((row) => row.item.unitCode))].map((code) => ({
                        key: code,
                        label: code,
                    })),
                match: (row, value) => row.item.unitCode === value,
            },
            render: (row) => <Text tone="secondary">{row.item.unitCode}</Text>,
        },
        {
            key: 'reorder',
            label: t('kitchen:ops.stock.columnReorderPar'),
            width: 130,
            priority: 50,
            value: reorderText,
            // By the threshold, the figure that raises the alarm; par breaks a tie. A shelf with no
            // threshold sorts last both ways — it is unset, not zero.
            sort: (left, right, direction) =>
                compareDecimal(
                    left.level?.reorderThreshold ?? null,
                    right.level?.reorderThreshold ?? null,
                    direction,
                ) ||
                compareDecimal(
                    left.level?.parLevel ?? null,
                    right.level?.parLevel ?? null,
                    direction,
                ),
            render: (row) => (
                <Text
                    variant={(row.level?.reorderThreshold ?? null) === null ? 'body' : 'mono'}
                    tone="secondary"
                    testID={`${stockItemRowTestId(String(row.item.id))}-threshold`}
                >
                    {reorderText(row)}
                </Text>
            ),
        },
        {
            key: 'lastPurchase',
            label: t('kitchen:ops.stock.columnLastPurchase'),
            width: 210,
            priority: 40,
            value: (row) => lastPurchaseText(row),
            // No header control, deliberately. The purchase is read for the visible page only (the
            // `414` above), so ordering or narrowing the book by it would act on 25 shelves and
            // shuffle the other pages by what had not been read. It needs the latest purchase on
            // the stock read itself, or a purchase read that is not keyed by a list of ids.
            render: (row) => renderLastPurchase(row),
        },
        {
            key: 'status',
            role: 'status',
            label: t('kitchen:list.columnStatus'),
            width: 96,
            priority: 80,
            value: (row) => t(STATE_LABEL[row.state]),
            filter: {
                values: () =>
                    LEVEL_STATES.map((state) => ({ key: state, label: t(STATE_LABEL[state]) })),
                match: (row, value) => row.state === value,
            },
            render: (row) => (
                <Badge
                    testID={`${stockItemRowTestId(String(row.item.id))}-status`}
                    tone={STATE_TONE[row.state]}
                    label={t(STATE_LABEL[row.state])}
                />
            ),
        },
    ];

    const controls = useColumnControls(filteredRows, columns, 'kitchen-stock');
    const totalPages = Math.max(1, Math.ceil(controls.rows.length / PAGE_SIZE));
    const currentPage = paging.key === controls.key ? Math.min(paging.page, totalPages) : 1;
    const from = (currentPage - 1) * PAGE_SIZE;
    const visible = controls.rows.slice(from, from + PAGE_SIZE);

    // Keyed on the ids' text: `controls.rows` is a fresh array each render, and the purchase read
    // must not become a fresh query with it.
    const visibleIdsKey = visible.map((row) => String(row.item.id)).join('\n');
    const pricedItemIds = useMemo(
        () =>
            visibleIdsKey === '' ? [] : (visibleIdsKey.split('\n') as unknown as StockItem['id'][]),
        [visibleIdsKey],
    );
    const latestPurchases = useItemLatestPurchasesQuery(pricedItemIds);

    const purchaseByItem = useMemo(() => {
        const byItem = new Map<string, ItemLatestPurchase>();
        for (const purchase of latestPurchases.data ?? []) {
            byItem.set(String(purchase.stockItemId), purchase);
        }
        return byItem;
    }, [latestPurchases.data]);

    function supplierLine(purchase: ItemLatestPurchase): string {
        return purchase.supplier === null
            ? t('kitchen:ops.stock.noPurchaseSupplier')
            : purchase.supplier.nameEn;
    }

    function purchasePrice(purchase: ItemLatestPurchase): string {
        return t('kitchen:ops.stock.lastPurchasePrice', {
            amount: formatter.formatNumber(Number(purchase.unitPriceAmount), {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            }),
            // Currency and unit come off the wire — never assumed.
            currency: purchase.costCurrencyCode ?? '',
            unit: purchase.unitCode ?? '',
        });
    }

    function purchaseSource(purchase: ItemLatestPurchase): string {
        return purchase.receivedAt === null
            ? supplierLine(purchase)
            : t('kitchen:ops.stock.lastPurchaseFrom', {
                  supplier: supplierLine(purchase),
                  date: formatter.formatDate(purchase.receivedAt, { dateStyle: 'medium' }),
              });
    }

    function lastPurchaseText(row: StockRow): string {
        const purchase = purchaseByItem.get(String(row.item.id));
        if (purchase === undefined) {
            return latestPurchases.isPending
                ? t('kitchen:ops.stock.lastPurchaseLoading')
                : t('kitchen:ops.stock.neverBought');
        }
        if (!canViewCosts || purchase.unitPriceAmount === null) {
            return `${t('kitchen:ops.stock.lastPurchaseHidden')} · ${supplierLine(purchase)}`;
        }
        return `${purchasePrice(purchase)} · ${purchaseSource(purchase)}`;
    }

    function renderLastPurchase(row: StockRow) {
        const testID = stockItemRowTestId(String(row.item.id));
        const purchase = purchaseByItem.get(String(row.item.id));

        // Absent means never bought at a price — the endpoint omits such items.
        if (purchase === undefined) {
            return (
                <Text tone="secondary" testID={`${testID}-never-bought`}>
                    {latestPurchases.isPending
                        ? t('kitchen:ops.stock.lastPurchaseLoading')
                        : t('kitchen:ops.stock.neverBought')}
                </Text>
            );
        }

        if (!canViewCosts || purchase.unitPriceAmount === null) {
            return (
                <View className="min-w-0 flex-col">
                    <Text tone="secondary" testID={`${testID}-price-hidden`}>
                        {t('kitchen:ops.stock.lastPurchaseHidden')}
                    </Text>
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                        {supplierLine(purchase)}
                    </Text>
                </View>
            );
        }

        return (
            <View className="min-w-0 flex-col">
                <Text variant="mono" testID={`${testID}-price`} numberOfLines={1}>
                    {purchasePrice(purchase)}
                </Text>
                <Text
                    variant="caption"
                    tone="secondary"
                    numberOfLines={1}
                    testID={`${testID}-price-source`}
                >
                    {purchaseSource(purchase)}
                </Text>
            </View>
        );
    }

    const openEditor = (row: StockRow) => {
        setViewing(null);
        setEditing(row);
    };

    const openHistory = (row: StockRow) => {
        router.push(`/kitchen/purchases-ledger?item=${String(row.item.id)}` as never);
    };

    /**
     * View for everyone, Adjust for a manager, History for anyone who may read costs — the ledger it
     * links into is behind `inventory.view_costs_organisation`, so a counter who may not read the
     * valuation is not handed a link to a forbidden page.
     */
    const rowActions = (row: StockRow): readonly MenuItem[] => {
        const testID = stockItemRowTestId(String(row.item.id));
        return [
            {
                key: 'view',
                label: t('kitchen:list.view'),
                icon: CATALOGUE_ROW_ICONS.view,
                testID: `${testID}-view`,
                onSelect: () => {
                    setViewing(row);
                },
            },
            ...(canManage
                ? [
                      {
                          key: 'adjust',
                          label: t('kitchen:catalogue.edit'),
                          icon: CATALOGUE_ROW_ICONS.edit,
                          testID: `${testID}-adjust`,
                          onSelect: () => {
                              openEditor(row);
                          },
                      },
                  ]
                : []),
            ...(canViewCosts
                ? [
                      {
                          key: 'history',
                          label: t('kitchen:ops.stock.history'),
                          icon: 'calendar' as const,
                          testID: `${testID}-history`,
                          onSelect: () => {
                              openHistory(row);
                          },
                      },
                  ]
                : []),
        ];
    };

    if (editing !== null) {
        // Re-read the row from the live data so a write that lands refreshes the editor's facts.
        const level = levelByItem.get(String(editing.item.id)) ?? null;
        return (
            <StockMovementEditor
                row={{ item: editing.item, level, state: levelState(level) }}
                onDone={() => {
                    setEditing(null);
                }}
                onReload={() => {
                    void items.refetch();
                    void levels.refetch();
                }}
            />
        );
    }

    const failure = toFailure(items.error) ?? toFailure(levels.error);
    const pending = items.isPending || levels.isPending;
    const unfiltered = trimmed === '' && segment === 'all' && !controls.filtered;
    const clearFilters = () => {
        setQuery('');
        setSegment('all');
        controls.clearFilters();
        resetPage();
    };

    const kindSegments: readonly CatalogueStatusSegment<Kind>[] = [
        { value: 'ingredients', label: t('kitchen:ops.stock.kindIngredients') },
        { value: 'products', label: t('kitchen:ops.stock.kindProducts') },
    ];
    const levelSegments: readonly CatalogueStatusSegment<LevelSegment>[] = [
        { value: 'all', label: t('kitchen:toolbar.statusAll') },
        { value: 'low', label: t('kitchen:ops.stock.lowBadge') },
        { value: 'out', label: t('kitchen:ops.stock.levelOut') },
        { value: 'ok', label: t('kitchen:ops.stock.inStockBadge') },
    ];

    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-stock-view"
                onBack={() => {
                    setViewing(null);
                }}
                title={viewing.item.nameEn}
                kind={t('kitchen:ops.stock.viewKind')}
                status={{
                    label: t(STATE_LABEL[viewing.state]),
                    tone: STATE_TONE[viewing.state],
                }}
                {...(viewing.state === 'ok'
                    ? {}
                    : {
                          note: t(
                              viewing.state === 'out'
                                  ? 'kitchen:ops.stock.viewNoteEmpty'
                                  : 'kitchen:ops.stock.viewNoteLow',
                          ),
                      })}
                fields={[
                    {
                        key: 'code',
                        label: t('kitchen:list.columnReference'),
                        value: viewing.item.code,
                        mono: true,
                    },
                    {
                        key: 'quantity',
                        label: t('kitchen:ops.stock.columnQuantity'),
                        value: quantityText(viewing),
                        mono: true,
                    },
                    {
                        key: 'unit',
                        label: t('kitchen:ops.stock.columnUnit'),
                        value: viewing.item.unitCode,
                    },
                    {
                        key: 'reorder',
                        label: t('kitchen:ops.stock.columnReorderPar'),
                        value: reorderText(viewing),
                    },
                    {
                        key: 'lastPurchase',
                        label: t('kitchen:ops.stock.columnLastPurchase'),
                        value: lastPurchaseText(viewing),
                    },
                ]}
                footNote={t('kitchen:ops.stock.ledgerNote')}
                {...(canManage
                    ? {
                          primaryAction: {
                              label: t('kitchen:ops.stock.adjust'),
                              onPress: () => {
                                  openEditor(viewing);
                              },
                          },
                      }
                    : {})}
            />
        );
    }

    return (
        <Stack space="md" testID="kitchen-stock-screen">
            {pending || failure !== null ? null : (
                <CatalogueStatCards
                    testID="kitchen-stock-stats"
                    cards={statCards(controls.rows, bookRows.length, unfiltered, t, clearFilters)}
                />
            )}

            <CatalogueToolbar<LevelSegment>
                testID="kitchen-stock-toolbar"
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    resetPage();
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:ops.stock.searchPlaceholder')}
                statusLabel={t('kitchen:ops.stock.levelLabel')}
                statusSegments={levelSegments}
                status={segment}
                onStatusChange={(next) => {
                    setSegment(next);
                    resetPage();
                }}
            >
                <ColumnPicker {...controls.picker} />
                <SegmentedControl
                    testID="kitchen-stock-kind"
                    label={t('kitchen:ops.stock.kindLabel')}
                    items={kindSegments.map((kindSegment) => ({
                        value: kindSegment.value,
                        label: kindSegment.label,
                        testID: `kitchen-stock-kind-${kindSegment.value}`,
                    }))}
                    value={kind}
                    onChange={(next) => {
                        setKind(next);
                        resetPage();
                    }}
                />
            </CatalogueToolbar>

            {pending ? (
                <Stack space="xs" testID="kitchen-stock-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-stock-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-stock-error"
                    failure={failure}
                    onRetry={() => {
                        void items.refetch();
                        void levels.refetch();
                    }}
                    retrying={items.isFetching || levels.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID={
                        bookRows.length === 0
                            ? `kitchen-stock-${kind}-empty`
                            : 'kitchen-stock-filtered-empty'
                    }
                    title={
                        bookRows.length === 0
                            ? t(
                                  kind === 'ingredients'
                                      ? 'kitchen:ops.stock.ingredientsEmptyTitle'
                                      : 'kitchen:ops.stock.productsEmptyTitle',
                              )
                            : t('kitchen:list.filteredEmptyTitle')
                    }
                    body={
                        bookRows.length === 0
                            ? t(
                                  kind === 'ingredients'
                                      ? 'kitchen:ops.stock.ingredientsEmptyBody'
                                      : 'kitchen:ops.stock.productsEmptyBody',
                              )
                            : t('kitchen:ops.stock.filteredEmptyBody')
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList<StockRow>
                        testID="kitchen-stock-table"
                        label={t(
                            kind === 'ingredients'
                                ? 'kitchen:ops.stock.kindIngredients'
                                : 'kitchen:ops.stock.kindProducts',
                        )}
                        columns={controls.columns}
                        rows={visible}
                        rowKey={(row) => String(row.item.id)}
                        density="sm"
                        onRowPress={canManage ? openEditor : setViewing}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={rowActions}
                    />

                    <CataloguePager
                        testID="kitchen-stock-pagination"
                        range={t('kitchen:catalogue.pagerRange', {
                            from: from + 1,
                            to: from + visible.length,
                            total: controls.rows.length,
                        })}
                        page={currentPage}
                        totalPages={totalPages}
                        onPageChange={(next) => {
                            setPaging({ key: controls.key, page: next });
                            setViewing(null);
                        }}
                        label={t('kitchen:catalogue.pagerLabel')}
                    />

                    <Text variant="caption" tone="secondary" testID="kitchen-stock-foot">
                        {t('kitchen:ops.stock.foot')}
                    </Text>
                </Stack>
            )}
        </Stack>
    );
}

/** Counted over the rows in hand, so the strip never contradicts the pager beneath it. */
function statCards(
    rows: readonly StockRow[],
    total: number,
    unfiltered: boolean,
    t: TFunction,
    clear: () => void,
): readonly CatalogueStatCard[] {
    const low = rows.filter((row) => row.state === 'low').length;
    const out = rows.filter((row) => row.state === 'out').length;
    const ok = rows.filter((row) => row.state === 'ok').length;
    return [
        {
            key: 'shown',
            label: t('kitchen:list.statShown'),
            value: String(rows.length),
            unit: t('kitchen:list.statShownUnit', { total }),
            caption: unfiltered
                ? t('kitchen:list.statShownUnfiltered')
                : t('kitchen:list.statShownFiltered'),
            mark: 'calendar',
            tone: 'brand',
            onPress: clear,
            accessibilityLabel: t('kitchen:list.statShownAction'),
        },
        {
            key: 'low',
            label: t('kitchen:ops.stock.metrics.lowStock'),
            value: String(low),
            unit: t('kitchen:ops.stock.statUnit'),
            caption: t('kitchen:ops.stock.statLowCaption'),
            mark: 'warning',
            tone: low === 0 ? 'default' : 'warning',
        },
        {
            key: 'out',
            label: t('kitchen:ops.stock.metrics.outOfStock'),
            value: String(out),
            unit: t('kitchen:ops.stock.statUnit'),
            caption: t('kitchen:ops.stock.statOutCaption'),
            mark: 'error',
            tone: out === 0 ? 'default' : 'danger',
        },
        {
            key: 'ok',
            label: t('kitchen:ops.stock.inStockBadge'),
            value: String(ok),
            unit: t('kitchen:ops.stock.statUnit'),
            caption: t('kitchen:ops.stock.statOkCaption'),
            mark: 'check',
        },
    ];
}

type MovementDirection = 'increase' | 'decrease' | 'waste';

/**
 * The `edStock` editor: **Reorder threshold**, then **Movement**, one save that posts whichever of
 * the two changed. There is no quantity field that writes a level — a movement is a signed ledger
 * entry, and the level is whatever the ledger sums to.
 */
function StockMovementEditor({
    row,
    onDone,
    onReload,
}: {
    readonly row: StockRow;
    readonly onDone: () => void;
    readonly onReload: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const access = useAccessState();
    const branchId = access.branch?.id ?? null;

    const adjustment = useRecordStockAdjustmentMutation();
    const waste = useRecordStockWasteMutation();
    const threshold = useSetStockThresholdMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });
    const concurrency = useOptimisticConcurrency({ onReload });

    const initialThreshold = row.level?.reorderThreshold ?? '';
    const initialPar = row.level?.parLevel ?? '';
    const [thresholdValue, setThresholdValue] = useState(initialThreshold);
    const [parLevelValue, setParLevelValue] = useState(initialPar);
    const [direction, setDirection] = useState<MovementDirection>('increase');
    const [quantity, setQuantity] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const thresholdTrimmed = thresholdValue.trim();
    const parTrimmed = parLevelValue.trim();
    const thresholdMagnitude = thresholdTrimmed === '' ? null : parseQuantity(thresholdTrimmed);
    const parMagnitude = parTrimmed === '' ? null : parseQuantity(parTrimmed);
    const thresholdInvalid = thresholdTrimmed !== '' && thresholdMagnitude === null;
    const parInvalid = parTrimmed !== '' && parMagnitude === null;
    const thresholdChanged =
        thresholdTrimmed !== initialThreshold.trim() || parTrimmed !== initialPar.trim();

    const quantityTrimmed = quantity.trim();
    const movementMagnitude = quantityTrimmed === '' ? null : parseQuantity(quantityTrimmed);
    const quantityInvalid =
        quantityTrimmed !== '' && (movementMagnitude === null || movementMagnitude <= 0);
    const hasMovement = movementMagnitude !== null && movementMagnitude > 0;

    const canSave =
        branchId !== null &&
        !thresholdInvalid &&
        !parInvalid &&
        !quantityInvalid &&
        (thresholdChanged || hasMovement);

    const name = row.item.nameEn;

    const edit = (setter: (value: string) => void) => (value: string) => {
        setter(value);
        guard.markDirty();
    };

    async function save() {
        if (!canSave || branchId === null) return;
        setSaving(true);
        setSaveError(null);
        try {
            if (thresholdChanged) {
                await threshold.mutateAsync({
                    branchId,
                    stockItemId: row.item.id,
                    reorderThreshold: thresholdMagnitude,
                    parLevel: parMagnitude,
                });
            }
            const note = notes.trim() === '' ? null : notes.trim();
            if (movementMagnitude !== null && hasMovement && direction === 'waste') {
                await waste.mutateAsync({
                    branchId,
                    stockItemId: row.item.id,
                    quantity: movementMagnitude,
                    notes: note,
                });
            } else if (movementMagnitude !== null && hasMovement) {
                await adjustment.mutateAsync({
                    branchId,
                    stockItemId: row.item.id,
                    quantityDelta:
                        direction === 'decrease' ? -movementMagnitude : movementMagnitude,
                    notes: note,
                });
            }
            guard.markClean();
            toast.show({
                testID: 'kitchen-stock-movement-toast',
                tone: 'success',
                message: hasMovement
                    ? direction === 'waste'
                        ? t('kitchen:ops.stock.wastedToast', { name })
                        : t('kitchen:ops.stock.adjustedToast', { name })
                    : thresholdMagnitude === null
                      ? t('kitchen:ops.stock.thresholdClearedToast', { name })
                      : t('kitchen:ops.stock.thresholdSetToast', { name }),
            });
            onDone();
        } catch (error) {
            if (!concurrency.capture(error)) {
                setSaveError(toFailure(error)?.message ?? t('kitchen:ops.stock.saveFailedBody'));
            }
        } finally {
            setSaving(false);
        }
    }

    return (
        <EditorFrame
            testID="kitchen-stock-editor"
            title={stockItemLabel(row.item)}
            titleChip={{ label: t('kitchen:ops.stock.chip'), tone: 'neutral' }}
            summary={
                <Text variant="caption" tone="secondary" testID="kitchen-stock-editor-summary">
                    {t('kitchen:ops.stock.editorSummary', {
                        code: row.item.code,
                        quantity:
                            row.level === null
                                ? formatter.formatNumber(0)
                                : formatter.formatNumber(Number(row.level.quantity)),
                        unit: row.item.unitCode,
                    })}
                </Text>
            }
            meta={null}
            guard={guard}
            concurrency={concurrency}
            onSaveDraft={() => {
                void save();
            }}
            saveLabel={t('kitchen:ops.stock.saveLabel')}
            saving={saving}
            saveDisabled={!canSave}
            onBack={onDone}
            backLabel={t('kitchen:ops.stock.backLabel')}
            banner={
                saveError === null ? null : (
                    <Callout
                        testID="kitchen-stock-movement-error"
                        role="alert"
                        tone="danger"
                        title={t('kitchen:ops.stock.saveFailedTitle')}
                        body={saveError}
                    />
                )
            }
        >
            <FormSection
                first
                testID="kitchen-stock-threshold-section"
                title={t('kitchen:ops.stock.fieldThreshold')}
            >
                <FormGrid testID="kitchen-stock-threshold-grid">
                    <TextInputField
                        testID="kitchen-stock-threshold-value"
                        label={t('kitchen:ops.stock.fieldThreshold')}
                        hint={t('kitchen:ops.stock.fieldThresholdHint')}
                        error={thresholdInvalid ? t('kitchen:ops.stock.numberInvalid') : undefined}
                        value={thresholdValue}
                        onChangeText={edit(setThresholdValue)}
                        keyboardType="decimal-pad"
                        size="sm"
                    />
                    <TextInputField
                        testID="kitchen-stock-threshold-par"
                        label={t('kitchen:ops.stock.fieldParLevel')}
                        hint={t('kitchen:ops.stock.fieldParLevelHint')}
                        error={parInvalid ? t('kitchen:ops.stock.numberInvalid') : undefined}
                        value={parLevelValue}
                        onChangeText={edit(setParLevelValue)}
                        keyboardType="decimal-pad"
                        size="sm"
                    />
                </FormGrid>
            </FormSection>

            <FormSection
                testID="kitchen-stock-movement-section"
                title={t('kitchen:ops.stock.sectionMovement')}
                description={t('kitchen:ops.stock.ledgerNote')}
            >
                <FormGrid testID="kitchen-stock-movement-grid">
                    <Select<MovementDirection>
                        testID="kitchen-stock-movement-direction"
                        label={t('kitchen:ops.stock.direction')}
                        options={[
                            { value: 'increase', label: t('kitchen:ops.stock.directionIncrease') },
                            { value: 'decrease', label: t('kitchen:ops.stock.directionDecrease') },
                            { value: 'waste', label: t('kitchen:ops.stock.waste') },
                        ]}
                        value={direction}
                        onChange={(next) => {
                            setDirection(next);
                            guard.markDirty();
                        }}
                    />
                    <TextInputField
                        testID="kitchen-stock-movement-quantity"
                        label={t('kitchen:ops.stock.fieldAdjustQuantity')}
                        hint={t('kitchen:ops.stock.quantityHint', { unit: row.item.unitCode })}
                        error={quantityInvalid ? t('kitchen:ops.stock.quantityInvalid') : undefined}
                        value={quantity}
                        onChangeText={edit(setQuantity)}
                        keyboardType="decimal-pad"
                        size="sm"
                    />
                    <TextInputField
                        testID="kitchen-stock-movement-notes"
                        span={2}
                        label={t('kitchen:ops.stock.fieldNotes')}
                        placeholder={t('kitchen:ops.stock.fieldNotesPlaceholder')}
                        value={notes}
                        onChangeText={edit(setNotes)}
                        size="sm"
                    />
                </FormGrid>
            </FormSection>
        </EditorFrame>
    );
}

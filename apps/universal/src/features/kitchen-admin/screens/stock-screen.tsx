import type { ItemLatestPurchase, StockItem, StockLevel } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Dialog,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    SegmentedControl,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useRouter } from 'expo-router';

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
import {
    INVENTORY_MANAGE_PERMISSION,
    INVENTORY_VIEW_COSTS_PERMISSION,
    INVENTORY_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { parseQuantity } from '../format.ts';
import { OpsPanel } from '../ops-panel.tsx';
import type { OpsMetric } from '../ops-panel.tsx';
import {
    isOutOfStock,
    stockItemLabel,
    stockItemRowTestId,
    stockLevelRowTestId,
} from '../ops-format.ts';

/**
 * `/kitchen/stock` — the inventory ledger (O1, reworked by INV2.0).
 *
 * ## Nothing is declared here any more
 *
 * A stock item is **derived**: one per ingredient in the library, one per product the kitchen buys
 * in to resell. There is no "add item" — a shelf follows an ingredient or a product, and a shelf
 * that followed neither was the orphan the derivation abolished. What this screen does is what a
 * kitchen actually does to stock: count it, waste it, and set the point it reorders at.
 *
 * ## Three lists, because they answer three different questions
 *
 * **Ingredients** and **Products** are the same table split by `backing` — raw goods the kitchen
 * cooks with, finished goods it resells. They are two books in one place rather than two tables in
 * the database: `stock_levels`, `stock_movements` and `goods_receipt_lines` all point at one
 * `stock_items`, and splitting it would have doubled all three. **Stock levels** is what the active
 * branch actually holds right now, denormalised with the item's own code and name so the table needs
 * no join (`contracts/kitchen-ops.ts`). A shelf with nothing received yet appears in the first two
 * and not the third, and that absence is itself the fact worth showing.
 *
 * ## Adjust and waste both act on an item, not a level
 *
 * `recordStockAdjustment` and `recordStockWaste` both create the level row if none exists yet, so
 * the row actions live on the *item* tables — the complete set of things that can be adjusted —
 * rather than on the levels table, which is only the subset that already has a quantity.
 *
 * ## The last-purchase column is a second read, joined here
 *
 * SUP2 adds "what did this last cost, and who from" to both item books. It cannot ride on the
 * stock rows: those come from Inventory, and Inventory may not import Procurement. So the price is
 * a separate Procurement read over the visible items' ids, joined on `stockItemId` in this screen.
 * One request for both books rather than one per row, and the join is a `Map` rather than a `find`
 * per cell for the same reason.
 *
 * Three cells, kept three: **Hidden** without the cost permission, an actual price with it, and
 * *never bought* when no priced receipt exists. The last two are not the same fact, and a person
 * who may not read costs still gets to see that something was bought.
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

type MovementMode = 'adjust' | 'waste';

/** The latest-purchase endpoint's own cap. Asking for more than it accepts would fail the lot. */
const MAX_PRICED_ITEMS = 200;

function Stock() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const router = useRouter();
    const access = useAccessState();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);
    const canViewCosts = useCan(INVENTORY_VIEW_COSTS_PERMISSION);
    const branchId = access.branch?.id ?? null;

    const items = useStockItemsQuery();
    const levels = useStockLevelsQuery();

    const adjustment = useRecordStockAdjustmentMutation();
    const waste = useRecordStockWasteMutation();
    const threshold = useSetStockThresholdMutation();

    const [movement, setMovement] = useState<{ item: StockItem; mode: MovementMode } | null>(null);
    const [movementQuantity, setMovementQuantity] = useState('');
    const [movementDirection, setMovementDirection] = useState<'increase' | 'decrease'>('increase');

    const [thresholdItem, setThresholdItem] = useState<StockItem | null>(null);
    const [thresholdValue, setThresholdValue] = useState('');
    const [parLevelValue, setParLevelValue] = useState('');

    const levelRows = levels.data ?? [];

    // The two books, split off `items.data` rather than off a `?? []` fallback: the fallback is a
    // fresh array on every render, which would make both memos recompute forever.
    //
    // The server's ranking — stocked first, then ever-moved, then by name — survives the split
    // because `filter` preserves order, and nothing here re-sorts. That is what keeps a
    // two-hundred-row ingredient library readable.
    const ingredientRows = useMemo(
        () => (items.data ?? []).filter((row) => row.backing === 'ingredient'),
        [items.data],
    );
    const productRows = useMemo(
        () => (items.data ?? []).filter((row) => row.backing === 'product'),
        [items.data],
    );

    // Both books at once, capped at the endpoint's own limit. A kitchen with more shelves than
    // that gets prices for the ranked head of the list — which is the part somebody scrolling
    // actually reads — rather than a refused request and no column at all.
    const pricedItemIds = useMemo(
        () => (items.data ?? []).slice(0, MAX_PRICED_ITEMS).map((row) => row.id),
        [items.data],
    );
    const latestPurchases = useItemLatestPurchasesQuery(pricedItemIds);

    // A map rather than a `find` per cell: the tables render every shelf, and a linear scan inside
    // a column renderer is the quiet O(n²) that only shows up on a real library.
    const purchaseByItem = useMemo(() => {
        const byItem = new Map<string, ItemLatestPurchase>();
        for (const purchase of latestPurchases.data ?? []) {
            byItem.set(String(purchase.stockItemId), purchase);
        }
        return byItem;
    }, [latestPurchases.data]);

    const metrics: readonly OpsMetric[] = [
        {
            key: 'ingredients',
            labelKey: 'kitchen:ops.stock.metrics.ingredients',
            value: items.isPending ? null : ingredientRows.length,
        },
        {
            key: 'products',
            labelKey: 'kitchen:ops.stock.metrics.products',
            value: items.isPending ? null : productRows.length,
        },
        {
            key: 'levels',
            labelKey: 'kitchen:ops.stock.metrics.levels',
            value: levels.isPending ? null : levelRows.length,
        },
        {
            key: 'outOfStock',
            labelKey: 'kitchen:ops.stock.metrics.outOfStock',
            value: levels.isPending
                ? null
                : levelRows.filter((level) => isOutOfStock(level.quantity)).length,
        },
        {
            key: 'lowStock',
            labelKey: 'kitchen:ops.stock.metrics.lowStock',
            value: levels.isPending ? null : levelRows.filter((level) => level.isLow).length,
        },
    ];

    function closeMovement() {
        setMovement(null);
        setMovementQuantity('');
        setMovementDirection('increase');
        adjustment.reset();
        waste.reset();
    }

    function openThreshold(item: StockItem) {
        const level = levelRows.find((row) => String(row.stockItemId) === String(item.id));
        setThresholdItem(item);
        setThresholdValue(level?.reorderThreshold ?? '');
        setParLevelValue(level?.parLevel ?? '');
        threshold.reset();
    }

    function closeThreshold() {
        setThresholdItem(null);
        setThresholdValue('');
        setParLevelValue('');
        threshold.reset();
    }

    const thresholdTrimmed = thresholdValue.trim();
    const parLevelTrimmed = parLevelValue.trim();
    const thresholdMagnitude = thresholdTrimmed === '' ? null : parseQuantity(thresholdTrimmed);
    const parLevelMagnitude = parLevelTrimmed === '' ? null : parseQuantity(parLevelTrimmed);
    // Each field is valid when blank (blank = clear) or a parseable non-negative number.
    const thresholdFieldsValid =
        (thresholdTrimmed === '' || thresholdMagnitude !== null) &&
        (parLevelTrimmed === '' || parLevelMagnitude !== null);
    const thresholdError = toFailure(threshold.error);

    function submitThreshold() {
        if (thresholdItem === null || branchId === null || !thresholdFieldsValid) {
            return;
        }
        const name = thresholdItem.nameEn;
        const cleared = thresholdMagnitude === null;
        threshold.mutate(
            {
                branchId,
                stockItemId: thresholdItem.id,
                reorderThreshold: thresholdMagnitude,
                parLevel: parLevelMagnitude,
            },
            {
                onSuccess: () => {
                    closeThreshold();
                    toast.show({
                        testID: 'kitchen-stock-threshold-toast',
                        tone: 'success',
                        message: cleared
                            ? t('kitchen:ops.stock.thresholdClearedToast', { name })
                            : t('kitchen:ops.stock.thresholdSetToast', { name }),
                    });
                },
            },
        );
    }

    const movementMagnitude = parseQuantity(movementQuantity);
    const movementPending = adjustment.isPending || waste.isPending;
    const movementError = toFailure(adjustment.error) ?? toFailure(waste.error);
    const movementValid = movementMagnitude !== null && movementMagnitude > 0;

    function submitMovement() {
        if (
            movement === null ||
            branchId === null ||
            movementMagnitude === null ||
            !movementValid
        ) {
            return;
        }
        const onSuccess = () => {
            closeMovement();
            toast.show({
                testID: 'kitchen-stock-movement-toast',
                tone: 'success',
                message:
                    movement.mode === 'adjust'
                        ? t('kitchen:ops.stock.adjustedToast', { name: movement.item.nameEn })
                        : t('kitchen:ops.stock.wastedToast', { name: movement.item.nameEn }),
            });
        };
        if (movement.mode === 'adjust') {
            adjustment.mutate(
                {
                    branchId,
                    stockItemId: movement.item.id,
                    quantityDelta:
                        movementDirection === 'decrease' ? -movementMagnitude : movementMagnitude,
                },
                { onSuccess },
            );
        } else {
            waste.mutate(
                {
                    branchId,
                    stockItemId: movement.item.id,
                    quantity: movementMagnitude,
                },
                { onSuccess },
            );
        }
    }

    /**
     * The 7c level meter: how close the shelf is to where it should be. The target is the par
     * level when one is set, else double the reorder threshold — "comfortably above the minimum".
     * A row with neither carries no meter: a bar with no target would be decoration inventing a
     * scale. The fill is a graphic, always beside the numeric columns that stay the record.
     */
    const levelMeter = (row: StockLevel) => {
        const quantity = Number(row.quantity);
        const par = row.parLevel === null ? null : Number(row.parLevel);
        const threshold = row.reorderThreshold === null ? null : Number(row.reorderThreshold);
        const target = par !== null && par > 0 ? par : threshold !== null ? threshold * 2 : null;
        if (target === null || target <= 0 || !Number.isFinite(quantity)) return null;
        const fraction = Math.max(0.04, Math.min(1, quantity / target));
        const fill = isOutOfStock(row.quantity)
            ? 'h-full rounded-full bg-danger'
            : row.isLow
              ? 'h-full rounded-full bg-warning'
              : // §1.3 permits brand-500 on graphics: this fill carries no text, and the quantity
                // and threshold columns beside it state the numbers.
                'h-full rounded-full bg-brand-500';
        return (
            <View
                testID={`${stockLevelRowTestId(row.id)}-meter`}
                aria-hidden
                className="h-2 w-full max-w-[160px] overflow-hidden rounded-full bg-surface-sunken"
            >
                <View className={fill} style={{ width: `${fraction * 100}%` }} />
            </View>
        );
    };

    const levelColumns: readonly TableColumn<StockLevel>[] = [
        {
            key: 'item',
            header: t('kitchen:ops.stock.columnItem'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Stack space="none">
                    <Text variant="bodyStrong">{row.itemNameEn}</Text>
                    <Text variant="caption" tone="secondary">
                        {row.itemCode}
                    </Text>
                </Stack>
            ),
        },
        {
            key: 'quantity',
            header: t('kitchen:ops.stock.columnQuantity'),
            numeric: true,
            primary: true,
            render: (row) => (
                <Inline space="xs" align="center" justify="end">
                    {row.isLow && !isOutOfStock(row.quantity) ? (
                        <Badge
                            testID={`${stockLevelRowTestId(row.id)}-low`}
                            tone="danger"
                            icon="warning"
                            label={t('kitchen:ops.stock.lowBadge')}
                        />
                    ) : null}
                    <Text
                        testID={`${stockLevelRowTestId(row.id)}-quantity`}
                        tone={isOutOfStock(row.quantity) || row.isLow ? 'danger' : 'primary'}
                    >
                        {formatter.formatNumber(Number(row.quantity))}
                    </Text>
                </Inline>
            ),
        },
        {
            key: 'level',
            header: t('kitchen:ops.stock.columnLevel'),
            render: (row) => levelMeter(row),
        },
        {
            key: 'threshold',
            header: t('kitchen:ops.stock.columnThreshold'),
            numeric: true,
            render: (row) => (
                <Text tone="secondary" testID={`${stockLevelRowTestId(row.id)}-threshold`}>
                    {row.reorderThreshold === null
                        ? t('kitchen:ops.stock.noThreshold')
                        : formatter.formatNumber(Number(row.reorderThreshold))}
                </Text>
            ),
        },
    ];

    const itemColumns: readonly TableColumn<StockItem>[] = [
        {
            key: 'name',
            header: t('kitchen:ops.stock.columnItem'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Stack space="none">
                    <Text
                        variant="bodyStrong"
                        testID={`${stockItemRowTestId(String(row.id))}-name`}
                    >
                        {row.nameEn}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {row.code}
                    </Text>
                </Stack>
            ),
        },
        {
            key: 'unit',
            header: t('kitchen:ops.stock.columnUnit'),
            render: (row) => <Text tone="secondary">{row.unitCode}</Text>,
        },
        {
            key: 'lastPurchase',
            header: t('kitchen:ops.stock.columnLastPurchase'),
            flex: 2,
            render: (row) => {
                const testID = stockItemRowTestId(String(row.id));
                const purchase = purchaseByItem.get(String(row.id));

                // Absent means never bought at a price — the endpoint omits such items rather
                // than answering a purchase-shaped object with nulls in it.
                if (purchase === undefined) {
                    return (
                        <Text tone="secondary" testID={`${testID}-never-bought`}>
                            {latestPurchases.isPending
                                ? t('kitchen:ops.stock.lastPurchaseLoading')
                                : t('kitchen:ops.stock.neverBought')}
                        </Text>
                    );
                }

                const supplierLine =
                    purchase.supplier === null
                        ? t('kitchen:ops.stock.noPurchaseSupplier')
                        : purchase.supplier.nameEn;

                if (!canViewCosts || purchase.unitPriceAmount === null) {
                    return (
                        <Stack space="none">
                            <Text tone="secondary" testID={`${testID}-price-hidden`}>
                                {t('kitchen:ops.stock.lastPurchaseHidden')}
                            </Text>
                            <Text variant="caption" tone="secondary">
                                {supplierLine}
                            </Text>
                        </Stack>
                    );
                }

                return (
                    <Stack space="none">
                        <Text variant="bodyStrong" testID={`${testID}-price`}>
                            {/* Currency and unit come off the wire — never assumed. */}
                            {t('kitchen:ops.stock.lastPurchasePrice', {
                                amount: formatter.formatNumber(Number(purchase.unitPriceAmount), {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                }),
                                currency: purchase.costCurrencyCode ?? '',
                                unit: purchase.unitCode ?? '',
                            })}
                        </Text>
                        <Text variant="caption" tone="secondary" testID={`${testID}-price-source`}>
                            {purchase.receivedAt === null
                                ? supplierLine
                                : t('kitchen:ops.stock.lastPurchaseFrom', {
                                      supplier: supplierLine,
                                      date: formatter.formatDate(purchase.receivedAt, {
                                          dateStyle: 'medium',
                                      }),
                                  })}
                        </Text>
                    </Stack>
                );
            },
        },
        {
            key: 'held',
            header: t('kitchen:ops.stock.columnHeld'),
            /*
             * Why the ranking is visible rather than only implied. Every ingredient in the library
             * gets a shelf, so most rows here are things this kitchen has never touched — and a
             * reader scrolling a long table needs to see which of them are real without comparing
             * against the levels table. `isStocked` is the same flag the ordering used.
             */
            render: (row) =>
                row.isStocked ? (
                    <Badge
                        testID={`${stockItemRowTestId(String(row.id))}-stocked`}
                        tone="success"
                        icon="check"
                        label={t('kitchen:ops.stock.inStockBadge')}
                    />
                ) : (
                    <Text
                        tone="secondary"
                        testID={`${stockItemRowTestId(String(row.id))}-unstocked`}
                    >
                        {row.hasHistory
                            ? t('kitchen:ops.stock.emptyShelf')
                            : t('kitchen:ops.stock.neverStocked')}
                    </Text>
                ),
        },
    ];

    /**
     * Adjust / waste / threshold for a manager, plus **History** for anyone who may read costs.
     *
     * The two halves are gated separately rather than the column being one permission's: the
     * ledger this links into is behind `inventory.view_costs_organisation`, and a person who may
     * count a shelf without reading its valuation would otherwise get a link to a forbidden page.
     */
    const itemRowAction =
        canManage || canViewCosts
            ? {
                  header: t('kitchen:ops.stock.columnActions'),
                  render: (row: StockItem) => (
                      <Inline space="xs" wrap justify="end">
                          {canManage ? (
                              <>
                                  <Button
                                      testID={`${stockItemRowTestId(String(row.id))}-adjust`}
                                      size="sm"
                                      variant="secondary"
                                      label={t('kitchen:ops.stock.adjust')}
                                      onPress={() => {
                                          setMovement({ item: row, mode: 'adjust' });
                                      }}
                                  />
                                  <Button
                                      testID={`${stockItemRowTestId(String(row.id))}-waste`}
                                      size="sm"
                                      variant="ghost"
                                      label={t('kitchen:ops.stock.waste')}
                                      onPress={() => {
                                          setMovement({ item: row, mode: 'waste' });
                                      }}
                                  />
                                  <Button
                                      testID={`${stockItemRowTestId(String(row.id))}-threshold`}
                                      size="sm"
                                      variant="ghost"
                                      label={t('kitchen:ops.stock.threshold')}
                                      onPress={() => {
                                          openThreshold(row);
                                      }}
                                  />
                              </>
                          ) : null}
                          {canViewCosts ? (
                              <Button
                                  testID={`${stockItemRowTestId(String(row.id))}-history`}
                                  size="sm"
                                  variant="ghost"
                                  label={t('kitchen:ops.stock.history')}
                                  onPress={() => {
                                      router.push(
                                          `/kitchen/purchases-ledger?item=${String(row.id)}` as never,
                                      );
                                  }}
                              />
                          ) : null}
                      </Inline>
                  ),
              }
            : undefined;

    const failure = toFailure(items.error) ?? toFailure(levels.error);

    return (
        <Stack space="lg" testID="kitchen-stock-screen">
            <OpsPanel
                testID="kitchen-stock-panel"
                titleKey="kitchen:ops.stock.title"
                subtitleKey="kitchen:ops.stock.subtitle"
                metrics={metrics}
                emptyTitleKey="kitchen:ops.stock.emptyTitle"
                emptyBodyKey="kitchen:ops.stock.emptyBody"
            >
                {items.isPending || levels.isPending ? (
                    <Stack space="sm" testID="kitchen-stock-loading">
                        {Array.from({ length: 3 }, (_, index) => (
                            <Skeleton key={index} heightClassName="h-10" />
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
                ) : (
                    <Stack space="lg" testID="kitchen-stock-content">
                        <Stack space="sm">
                            <Heading level={2} testID="kitchen-stock-levels-title">
                                {t('kitchen:ops.stock.levelsTitle')}
                            </Heading>
                            {levelRows.length === 0 ? (
                                <Text tone="secondary" testID="kitchen-stock-levels-empty">
                                    {t('kitchen:ops.stock.noLevels')}
                                </Text>
                            ) : (
                                <Table<StockLevel>
                                    testID="kitchen-stock-levels-table"
                                    caption={t('kitchen:ops.stock.levelsTitle')}
                                    captionHidden
                                    columns={levelColumns}
                                    rows={levelRows}
                                    rowKey={(row) => row.id}
                                />
                            )}
                        </Stack>

                        <Stack space="sm">
                            <Heading level={2} testID="kitchen-stock-ingredients-title">
                                {t('kitchen:ops.stock.ingredientsTitle')}
                            </Heading>
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:ops.stock.ingredientsHint')}
                            </Text>

                            {ingredientRows.length === 0 ? (
                                <EmptyState
                                    testID="kitchen-stock-ingredients-empty"
                                    title={t('kitchen:ops.stock.ingredientsEmptyTitle')}
                                    body={t('kitchen:ops.stock.ingredientsEmptyBody')}
                                />
                            ) : (
                                <Table<StockItem>
                                    testID="kitchen-stock-ingredients-table"
                                    caption={t('kitchen:ops.stock.ingredientsTitle')}
                                    captionHidden
                                    columns={itemColumns}
                                    rows={ingredientRows}
                                    rowKey={(row) => String(row.id)}
                                    rowAction={itemRowAction}
                                />
                            )}
                        </Stack>

                        <Stack space="sm">
                            <Heading level={2} testID="kitchen-stock-products-title">
                                {t('kitchen:ops.stock.productsTitle')}
                            </Heading>
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:ops.stock.productsHint')}
                            </Text>

                            {productRows.length === 0 ? (
                                <EmptyState
                                    testID="kitchen-stock-products-empty"
                                    title={t('kitchen:ops.stock.productsEmptyTitle')}
                                    body={t('kitchen:ops.stock.productsEmptyBody')}
                                />
                            ) : (
                                <Table<StockItem>
                                    testID="kitchen-stock-products-table"
                                    caption={t('kitchen:ops.stock.productsTitle')}
                                    captionHidden
                                    columns={itemColumns}
                                    rows={productRows}
                                    rowKey={(row) => String(row.id)}
                                    rowAction={itemRowAction}
                                />
                            )}
                        </Stack>
                    </Stack>
                )}
            </OpsPanel>

            <Dialog
                testID="kitchen-stock-movement-dialog"
                open={movement !== null}
                onClose={closeMovement}
                title={
                    movement === null
                        ? ''
                        : t(
                              movement.mode === 'adjust'
                                  ? 'kitchen:ops.stock.adjustTitle'
                                  : 'kitchen:ops.stock.wasteTitle',
                              { name: stockItemLabel(movement.item) },
                          )
                }
                actions={
                    <>
                        <Button
                            testID="kitchen-stock-movement-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={closeMovement}
                        />
                        <Button
                            testID="kitchen-stock-movement-confirm"
                            label={t('kitchen:common.save')}
                            loading={movementPending}
                            disabled={branchId === null || !movementValid}
                            onPress={submitMovement}
                        />
                    </>
                }
            >
                <Stack space="md">
                    {movementError === null ? null : (
                        <Text testID="kitchen-stock-movement-error" tone="danger">
                            {movementError.message}
                        </Text>
                    )}
                    {movement?.mode === 'adjust' ? (
                        <SegmentedControl
                            testID="kitchen-stock-movement-direction"
                            label={t('kitchen:ops.stock.direction')}
                            block
                            value={movementDirection}
                            onChange={setMovementDirection}
                            items={[
                                {
                                    value: 'increase',
                                    label: t('kitchen:ops.stock.directionIncrease'),
                                },
                                {
                                    value: 'decrease',
                                    label: t('kitchen:ops.stock.directionDecrease'),
                                },
                            ]}
                        />
                    ) : null}
                    <TextInputField
                        testID="kitchen-stock-movement-quantity"
                        label={
                            movement?.mode === 'waste'
                                ? t('kitchen:ops.stock.fieldWasteQuantity')
                                : t('kitchen:ops.stock.fieldAdjustQuantity')
                        }
                        hint={
                            movement?.mode === 'adjust'
                                ? t('kitchen:ops.stock.adjustHint')
                                : undefined
                        }
                        value={movementQuantity}
                        onChangeText={setMovementQuantity}
                        keyboardType="decimal-pad"
                    />
                </Stack>
            </Dialog>

            <Dialog
                testID="kitchen-stock-threshold-dialog"
                open={thresholdItem !== null}
                onClose={closeThreshold}
                title={
                    thresholdItem === null
                        ? ''
                        : t('kitchen:ops.stock.thresholdTitle', {
                              name: stockItemLabel(thresholdItem),
                          })
                }
                actions={
                    <>
                        <Button
                            testID="kitchen-stock-threshold-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={closeThreshold}
                        />
                        <Button
                            testID="kitchen-stock-threshold-confirm"
                            label={t('kitchen:common.save')}
                            loading={threshold.isPending}
                            disabled={branchId === null || !thresholdFieldsValid}
                            onPress={submitThreshold}
                        />
                    </>
                }
            >
                <Stack space="md">
                    {thresholdError === null ? null : (
                        <Text testID="kitchen-stock-threshold-error" tone="danger">
                            {thresholdError.message}
                        </Text>
                    )}
                    <TextInputField
                        testID="kitchen-stock-threshold-value"
                        label={t('kitchen:ops.stock.fieldThreshold')}
                        hint={t('kitchen:ops.stock.fieldThresholdHint')}
                        value={thresholdValue}
                        onChangeText={setThresholdValue}
                        keyboardType="decimal-pad"
                    />
                    <TextInputField
                        testID="kitchen-stock-threshold-par"
                        label={t('kitchen:ops.stock.fieldParLevel')}
                        hint={t('kitchen:ops.stock.fieldParLevelHint')}
                        value={parLevelValue}
                        onChangeText={setParLevelValue}
                        keyboardType="decimal-pad"
                    />
                </Stack>
            </Dialog>
        </Stack>
    );
}

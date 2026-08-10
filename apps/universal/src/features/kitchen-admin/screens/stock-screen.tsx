import type { StockItem, StockLevel } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Dialog,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    SegmentedControl,
    Select,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { IngredientId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { ingredientsFromPages, useIngredientsQuery } from '../../../data/kitchen-admin-hooks.ts';
import {
    useCreateStockItemMutation,
    useRecordStockAdjustmentMutation,
    useRecordStockWasteMutation,
    useSetStockThresholdMutation,
    useStockItemsQuery,
    useStockLevelsQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { INVENTORY_MANAGE_PERMISSION, INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, parseQuantity } from '../format.ts';
import { OpsPanel } from '../ops-panel.tsx';
import type { OpsMetric } from '../ops-panel.tsx';
import { isOutOfStock, stockItemLabel, stockItemRowTestId, stockLevelRowTestId } from '../ops-format.ts';

/**
 * `/kitchen/stock` — the inventory ledger (O1).
 *
 * ## Two lists, not one, because they answer different questions
 *
 * "Stock items" is the master data — every SKU the kitchen has declared, whether or not anything
 * has ever been received against it. "Stock levels" is what the active branch actually holds right
 * now, denormalised with the item's own code and name so the table needs no join
 * (`contracts/kitchen-ops.ts`). A brand-new item with nothing received yet appears in the first
 * table and not the second, and that absence is itself the fact worth showing rather than a row of
 * zeroes this contract has no endpoint to have produced.
 *
 * ## Adjust and waste both act on an item, not a level
 *
 * `recordStockAdjustment` and `recordStockWaste` both create the level row if none exists yet — see
 * the mock store's own note — so the row action lives on the *items* table, which is the complete
 * set of things that can be adjusted, rather than on the levels table, which is only the subset that
 * already has a quantity.
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

const NO_INGREDIENT = '__none__';

function Stock() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const toast = useToast();
    const access = useAccessState();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);
    const branchId = access.branch?.id ?? null;

    const items = useStockItemsQuery();
    const levels = useStockLevelsQuery();
    const ingredients = useIngredientsQuery({ limit: 100 });

    const createItem = useCreateStockItemMutation();
    const adjustment = useRecordStockAdjustmentMutation();
    const waste = useRecordStockWasteMutation();
    const threshold = useSetStockThresholdMutation();

    const [creating, setCreating] = useState(false);
    const [newCode, setNewCode] = useState('');
    const [newName, setNewName] = useState('');
    const [newUnit, setNewUnit] = useState('kg');
    const [newIngredientId, setNewIngredientId] = useState<string>(NO_INGREDIENT);

    const [movement, setMovement] = useState<{ item: StockItem; mode: MovementMode } | null>(null);
    const [movementQuantity, setMovementQuantity] = useState('');
    const [movementDirection, setMovementDirection] = useState<'increase' | 'decrease'>('increase');

    const [thresholdItem, setThresholdItem] = useState<StockItem | null>(null);
    const [thresholdValue, setThresholdValue] = useState('');
    const [parLevelValue, setParLevelValue] = useState('');

    const itemRows = items.data ?? [];
    const levelRows = levels.data ?? [];

    const metrics: readonly OpsMetric[] = [
        {
            key: 'items',
            labelKey: 'kitchen:ops.stock.metrics.items',
            value: items.isPending ? null : itemRows.length,
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

    const ingredientOptions = useMemo(
        () => [
            { value: NO_INGREDIENT, label: t('kitchen:ops.stock.noIngredientOption') },
            ...ingredientsFromPages(ingredients.data?.pages).map((ingredient) => ({
                value: String(ingredient.id),
                label: displayName(ingredient.name, locale).value,
            })),
        ],
        [ingredients.data, locale, t],
    );

    function closeCreate() {
        setCreating(false);
        setNewCode('');
        setNewName('');
        setNewUnit('kg');
        setNewIngredientId(NO_INGREDIENT);
        createItem.reset();
    }

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
        if (movement === null || branchId === null || movementMagnitude === null || !movementValid) {
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
            key: 'ingredient',
            header: t('kitchen:ops.stock.columnIngredient'),
            render: (row) =>
                row.ingredientId === null ? (
                    <Text tone="secondary">{t('kitchen:ops.stock.noIngredient')}</Text>
                ) : (
                    <Text tone="secondary">{t('kitchen:ops.stock.linkedIngredient')}</Text>
                ),
        },
    ];

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
                            <Inline space="sm" align="center" justify="between" wrap>
                                <Heading level={2} testID="kitchen-stock-items-title">
                                    {t('kitchen:ops.stock.itemsTitle')}
                                </Heading>
                                {canManage ? (
                                    <Button
                                        testID="kitchen-stock-add-item"
                                        size="sm"
                                        label={t('kitchen:ops.stock.addItem')}
                                        onPress={() => {
                                            setCreating(true);
                                        }}
                                    />
                                ) : null}
                            </Inline>

                            {itemRows.length === 0 ? (
                                <EmptyState
                                    testID="kitchen-stock-items-empty"
                                    title={t('kitchen:ops.stock.emptyTitle')}
                                    body={t('kitchen:ops.stock.emptyBody')}
                                />
                            ) : (
                                <Table<StockItem>
                                    testID="kitchen-stock-items-table"
                                    caption={t('kitchen:ops.stock.itemsTitle')}
                                    captionHidden
                                    columns={itemColumns}
                                    rows={itemRows}
                                    rowKey={(row) => String(row.id)}
                                    rowAction={
                                        canManage
                                            ? {
                                                  header: t('kitchen:ops.stock.columnActions'),
                                                  render: (row) => (
                                                      <Inline space="xs" wrap justify="end">
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
                                                      </Inline>
                                                  ),
                                              }
                                            : undefined
                                    }
                                />
                            )}
                        </Stack>
                    </Stack>
                )}
            </OpsPanel>

            <Dialog
                testID="kitchen-stock-create-dialog"
                open={creating}
                onClose={closeCreate}
                title={t('kitchen:ops.stock.addItemTitle')}
                actions={
                    <>
                        <Button
                            testID="kitchen-stock-create-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={closeCreate}
                        />
                        <Button
                            testID="kitchen-stock-create-confirm"
                            label={t('kitchen:common.save')}
                            loading={createItem.isPending}
                            disabled={newCode.trim() === '' || newName.trim() === ''}
                            onPress={() => {
                                createItem.mutate(
                                    {
                                        code: newCode.trim(),
                                        nameEn: newName.trim(),
                                        unitCode: newUnit.trim() === '' ? 'kg' : newUnit.trim(),
                                        ingredientId:
                                            newIngredientId === NO_INGREDIENT
                                                ? null
                                                : IngredientId.unsafe(newIngredientId),
                                    },
                                    {
                                        onSuccess: () => {
                                            closeCreate();
                                            toast.show({
                                                testID: 'kitchen-stock-created-toast',
                                                tone: 'success',
                                                message: t('kitchen:ops.stock.createdToast', {
                                                    name: newName.trim(),
                                                }),
                                            });
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Stack space="md">
                    {createItem.error === null ? null : (
                        <Text testID="kitchen-stock-create-error" tone="danger">
                            {toFailure(createItem.error)?.message ?? t('kitchen:ops.stock.saveFailed')}
                        </Text>
                    )}
                    <TextInputField
                        testID="kitchen-stock-create-code"
                        label={t('kitchen:ops.stock.fieldCode')}
                        value={newCode}
                        onChangeText={setNewCode}
                        required
                    />
                    <TextInputField
                        testID="kitchen-stock-create-name"
                        label={t('kitchen:ops.stock.fieldName')}
                        value={newName}
                        onChangeText={setNewName}
                        required
                    />
                    <TextInputField
                        testID="kitchen-stock-create-unit"
                        label={t('kitchen:ops.stock.fieldUnit')}
                        hint={t('kitchen:ops.stock.fieldUnitHint')}
                        value={newUnit}
                        onChangeText={setNewUnit}
                    />
                    <Select
                        testID="kitchen-stock-create-ingredient"
                        label={t('kitchen:ops.stock.fieldIngredient')}
                        options={ingredientOptions}
                        value={newIngredientId}
                        onChange={setNewIngredientId}
                        searchable
                    />
                </Stack>
            </Dialog>

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
                                { value: 'increase', label: t('kitchen:ops.stock.directionIncrease') },
                                { value: 'decrease', label: t('kitchen:ops.stock.directionDecrease') },
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

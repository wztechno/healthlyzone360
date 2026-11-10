import type { DuplicateStockGroup } from '@healthy360/api-client/contracts';
import {
    Button,
    Cascade,
    Dialog,
    EmptyState,
    ErrorState,
    TableSkeleton,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useDismissDuplicateStockMutation,
    useDuplicateStockQuery,
    useMergeDuplicateStockMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { INVENTORY_MANAGE_PERMISSION, INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import { unitCodeLabel } from '../format.ts';

type Shelf = DuplicateStockGroup['shelves'][number];

/**
 * `/kitchen/stock-duplicates` — the stock rows sharing a name that `kitchen:merge-duplicate-stock`
 * left for a person, each with its reason. A manager answers from the row's menu (the row-action
 * pattern of `stock-screen.tsx`): **Keep both** for any group, and **Merge into …** for two shelves
 * that both have history, offered once the shelf that goes has been counted to zero; until then
 * the item is disabled and says so, and **Count … to zero** beside it opens that shelf's count on
 * Stock and comes back here. Merge asks first (the confirm dialog of
 * `consumption-exceptions-screen.tsx`), because it cannot be undone here.
 */
export function StockDuplicatesScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-stock-duplicates"
        >
            <StockDuplicatesList />
        </Gate>
    );
}

function StockDuplicatesList() {
    const { t } = useTranslation();
    const router = useRouter();
    const duplicates = useDuplicateStockQuery();
    const failure = toFailure(duplicates.error);
    const rows = duplicates.data ?? [];
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);
    const merge = useMergeDuplicateStockMutation();
    const dismiss = useDismissDuplicateStockMutation();
    const toast = useToast();
    const [merging, setMerging] = useState<{ readonly keep: Shelf; readonly drop: Shelf } | null>(
        null,
    );

    const showFailure = (error: unknown) => {
        toast.show({
            testID: 'kitchen-stock-duplicates-failed-toast',
            tone: 'danger',
            message: toFailure(error)?.message ?? t('kitchen:stockDuplicates.actionFailedToast'),
        });
    };

    const keepBoth = (row: DuplicateStockGroup) => {
        dismiss.mutate(
            row.shelves.map((shelf) => shelf.id),
            {
                onSuccess: () => {
                    toast.show({
                        testID: 'kitchen-stock-duplicates-kept-toast',
                        tone: 'success',
                        message: t('kitchen:stockDuplicates.keptToast', { name: row.name }),
                    });
                },
                onError: showFailure,
            },
        );
    };

    const confirmMerge = () => {
        if (merging === null) return;
        const { keep, drop } = merging;
        merge.mutate(
            { keepId: keep.id, dropId: drop.id },
            {
                onSuccess: () => {
                    setMerging(null);
                    toast.show({
                        testID: 'kitchen-stock-duplicates-merged-toast',
                        tone: 'success',
                        message: t('kitchen:stockDuplicates.mergedToast', {
                            drop: drop.code,
                            keep: keep.code,
                        }),
                    });
                },
                onError: (error) => {
                    setMerging(null);
                    showFailure(error);
                },
            },
        );
    };

    /**
     * Merge into either side of a pair that both have history; the one that goes must hold nothing.
     * A shelf still holding stock gets one Count item, after the merges, however many pairs it is in.
     */
    const rowActions = (row: DuplicateStockGroup): readonly MenuItem[] => {
        const testID = `kitchen-stock-duplicates-row-${row.shelves[0]?.id ?? row.name}`;
        const isHeld = (shelf: Shelf) => Number(shelf.quantity) !== 0;
        const pairs = row.reason === 'both_have_history';
        const merges: readonly MenuItem[] = pairs
            ? row.shelves.flatMap((keep) =>
                  row.shelves
                      .filter((drop) => drop.id !== keep.id)
                      .map((drop): MenuItem => {
                          const held = isHeld(drop);
                          return {
                              key: `merge-${keep.id}-${drop.id}`,
                              label: held
                                  ? t('kitchen:stockDuplicates.mergeBlocked', { code: drop.code })
                                  : t('kitchen:stockDuplicates.mergeInto', { code: keep.code }),
                              icon: 'layers',
                              disabled: held,
                              testID: `${testID}-merge-${keep.id}-${drop.id}`,
                              onSelect: () => {
                                  setMerging({ keep, drop });
                              },
                          };
                      }),
              )
            : [];
        // Shelves are distinct rows, so one item per held shelf is already deduplicated by id.
        const counts: readonly MenuItem[] = pairs
            ? row.shelves.filter(isHeld).map((shelf): MenuItem => ({
                  key: `count-${shelf.id}`,
                  label: t('kitchen:stockDuplicates.countToZero', { code: shelf.code }),
                  icon: CATALOGUE_ROW_ICONS.edit,
                  testID: `${testID}-count-${shelf.id}`,
                  onSelect: () => {
                      router.push(
                          withReturnTo(
                              withQuery('/kitchen/stock', {
                                  shelf: shelf.id,
                                  direction: 'count',
                              }),
                              '/kitchen/stock-duplicates',
                          ) as never,
                      );
                  },
              }))
            : [];

        return [
            ...merges,
            ...counts,
            {
                key: 'keep-both',
                label: t('kitchen:stockDuplicates.keepBoth'),
                icon: 'check',
                disabled: dismiss.isPending,
                testID: `${testID}-keep-both`,
                onSelect: () => {
                    keepBoth(row);
                },
            },
        ];
    };

    const shelvesOf = (row: DuplicateStockGroup): string =>
        row.shelves
            .map((shelf) =>
                t('kitchen:stockDuplicates.shelf', {
                    code: shelf.code,
                    quantity: Number(shelf.quantity),
                    unit: unitCodeLabel(shelf.unitCode, t),
                }),
            )
            .join(' · ');

    const columns: readonly CatalogueColumn<DuplicateStockGroup>[] = [
        {
            key: 'name',
            role: 'title',
            label: t('kitchen:stockDuplicates.columnName'),
            width: 220,
            priority: 100,
            value: (row) => row.name,
            render: (row) => <Text variant="strong">{row.name}</Text>,
        },
        {
            key: 'reason',
            role: 'meta',
            label: t('kitchen:stockDuplicates.columnReason'),
            width: 320,
            priority: 90,
            value: (row) => t(`kitchen:stockDuplicates.reason.${row.reason}`),
            // The reason is what the reader decides on, so it wraps rather than ending in an ellipsis.
            render: (row) => (
                <View className="min-w-0 flex-1 py-1">
                    <Text numberOfLines={3}>
                        {t(`kitchen:stockDuplicates.reason.${row.reason}`)}
                    </Text>
                </View>
            ),
        },
        {
            key: 'shelves',
            role: 'meta',
            label: t('kitchen:stockDuplicates.columnShelves'),
            width: 320,
            priority: 80,
            value: shelvesOf,
            render: (row) => (
                <View className="min-w-0 flex-1 py-1">
                    <Text tone="secondary" numberOfLines={3}>
                        {shelvesOf(row)}
                    </Text>
                </View>
            ),
        },
    ];

    return (
        <Cascade space="md" testID="kitchen-stock-duplicates-screen">
            {duplicates.isPending ? (
                <TableSkeleton
                    testID="kitchen-stock-duplicates-loading"
                    partTestID="kitchen-stock-duplicates"
                />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-stock-duplicates-error"
                    failure={failure}
                    onRetry={() => {
                        void duplicates.refetch();
                    }}
                    retrying={duplicates.isFetching}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-stock-duplicates-empty"
                    title={t('kitchen:stockDuplicates.emptyTitle')}
                    body={t('kitchen:stockDuplicates.emptyBody')}
                />
            ) : (
                <CatalogueList<DuplicateStockGroup>
                    testID="kitchen-stock-duplicates-table"
                    label={t('kitchen:stockDuplicates.caption')}
                    columns={columns}
                    rows={rows}
                    rowKey={(row) => row.name}
                    rowActionsLabel={t('kitchen:list.rowActions')}
                    rowActions={canManage ? rowActions : undefined}
                />
            )}

            <Dialog
                testID="kitchen-stock-duplicates-merge-dialog"
                open={merging !== null}
                onClose={() => {
                    setMerging(null);
                }}
                title={t('kitchen:stockDuplicates.mergeTitle', {
                    drop: merging?.drop.code ?? '',
                    keep: merging?.keep.code ?? '',
                })}
                description={t('kitchen:stockDuplicates.mergeBody', {
                    drop: merging?.drop.code ?? '',
                    keep: merging?.keep.code ?? '',
                })}
                actions={
                    <>
                        <Button
                            testID="kitchen-stock-duplicates-merge-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setMerging(null);
                            }}
                        />
                        <Button
                            testID="kitchen-stock-duplicates-merge-confirm"
                            variant="danger"
                            label={t('kitchen:stockDuplicates.mergeConfirm')}
                            loading={merge.isPending}
                            onPress={confirmMerge}
                        />
                    </>
                }
            />
        </Cascade>
    );
}

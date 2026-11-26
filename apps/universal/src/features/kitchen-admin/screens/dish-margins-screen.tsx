import type { DishMargin } from '@healthy360/api-client/contracts';
import {
    Badge,
    Cascade,
    DATA_TABLE_ROW_ICONS,
    DataTable,
    EmptyState,
    ErrorState,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { DataTableColumn, MenuItem } from '@healthy360/design-system';
import type { TFunction } from 'i18next';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useDishMarginsQuery } from '../../../data/kitchen-ops-hooks.ts';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure } from '../catalogue/lens-bar.tsx';
import { RECIPE_VIEW_COSTS_PERMISSION, RECIPE_VIEW_PERMISSION } from '../entity-registry.ts';
import { unitCodeLabel } from '../format.ts';

/**
 * `/kitchen/dish-margins` — what each dish earns at today's costs, lowest first.
 *
 * One list in the cash report's table. A withheld margin is a badge with its reason and never a
 * number: a margin over part of a recipe reads like a whole one and is too high. Below target is a
 * warning badge with its wording, so colour is not the only signal.
 *
 * A row opens its dish's recipe on Production, and its actions open it on Production or on Packs & prices
 * (where each pack's price is set), each coming back here. Only for a reader who may open recipes.
 */

const EM_DASH = '—';
const RETURN_HREF = '/kitchen/dish-margins';

/** The dish's recipe, under its item's address, on one editor tab. */
function recipeHref(row: DishMargin, tab: 'production' | 'packaging'): string {
    return withReturnTo(
        withQuery(`/kitchen/recipes/item/${encodeURIComponent(row.catalogueItemId)}`, {
            kind: row.itemType,
            tab,
        }),
        RETURN_HREF,
    );
}

export function DishMarginsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [RECIPE_VIEW_COSTS_PERMISSION] }}
            testID="kitchen-dish-margins"
        >
            <DishMarginsPage />
        </Gate>
    );
}

function DishMarginsPage() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const report = useDishMarginsQuery();
    const router = useRouter();
    /** The Below target figure pressed: the list narrowed to the dishes under the target. */
    const [belowOnly, setBelowOnly] = useState(false);
    const canOpenRecipe = useCan(RECIPE_VIEW_PERMISSION);
    const open = (row: DishMargin, tab: 'production' | 'packaging') => {
        router.push(recipeHref(row, tab) as never);
    };
    const rowActions = (row: DishMargin): readonly MenuItem[] => [
        {
            key: 'recipe',
            label: t('kitchen:ops.dishMargins.openRecipe'),
            icon: DATA_TABLE_ROW_ICONS.view,
            onSelect: () => {
                open(row, 'production');
            },
        },
        {
            key: 'price',
            label: t('kitchen:ops.dishMargins.changePrice'),
            icon: 'tag',
            onSelect: () => {
                open(row, 'packaging');
            },
        },
    ];

    const failure = toFailure(report.error);

    const name = (row: DishMargin) => (locale === 'ar' ? row.name.ar : '') || row.name.en;
    const money = (amount: string | null, currency: string | null) =>
        amount === null
            ? EM_DASH
            : `${formatter.formatNumber(Number(amount), {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
              })} ${currency ?? ''}`.trim();
    const packText = (row: DishMargin) => {
        if (row.pack === null) return EM_DASH;
        const label = row.pack.label ?? t('kitchen:packs.unnamed');
        return row.pack.fill === null
            ? label
            : t('kitchen:packs.packWithFill', {
                  name: label,
                  fill: `${formatter.formatNumber(Number(row.pack.fill.quantity), {
                      maximumFractionDigits: 3,
                  })} ${unitCodeLabel(row.pack.fill.unit, t)}`,
              });
    };

    const columns: readonly DataTableColumn<DishMargin>[] = [
        {
            key: 'dish',
            role: 'title',
            value: name,
            label: t('kitchen:ops.dishMargins.columnDish'),
            width: 260,
            priority: 100,
            render: (row) => <Text variant="strong">{name(row)}</Text>,
        },
        {
            key: 'pack',
            label: t('kitchen:packs.columnPack'),
            width: 180,
            priority: 75,
            render: (row) => (
                <Text tone="secondary" numberOfLines={1} testID={`kitchen-dish-pack-${row.id}`}>
                    {packText(row)}
                </Text>
            ),
        },
        {
            key: 'place',
            label: t('kitchen:ops.dishMargins.columnChannel'),
            width: 110,
            priority: 70,
            render: (row) => (
                <Text tone="secondary">
                    {t(
                        row.place === 'home'
                            ? 'kitchen:packs.placeHome'
                            : 'kitchen:packs.placeBusiness',
                    )}
                </Text>
            ),
        },
        {
            key: 'price',
            label: t('kitchen:ops.dishMargins.columnPrice'),
            width: 130,
            priority: 80,
            render: (row) => (
                <Text variant="mono" tone="secondary">
                    {money(row.priceAmount, row.currencyCode)}
                </Text>
            ),
        },
        {
            key: 'cost',
            label: t('kitchen:ops.dishMargins.columnCost'),
            width: 130,
            priority: 85,
            render: (row) => (
                <Text variant="mono" tone="secondary" testID={`kitchen-dish-cost-${row.id}`}>
                    {/* The packaging is not known, so only what the fill costs can be said. */}
                    {row.withheldReason === 'packaging_unknown' && row.contentsAmount !== null
                        ? t('kitchen:ops.dishMargins.contentsCost', {
                              amount: money(row.contentsAmount, row.currencyCode),
                          })
                        : money(row.costAmount, row.currencyCode)}
                </Text>
            ),
        },
        {
            key: 'margin',
            role: 'metric',
            label: t('kitchen:ops.dishMargins.columnMargin'),
            width: 100,
            priority: 95,
            render: (row) => (
                <Text variant="mono" testID={`kitchen-dish-margin-${row.id}`}>
                    {row.marginPercent === null
                        ? EM_DASH
                        : t('kitchen:ops.dishMargins.marginValue', {
                              percent: row.marginPercent,
                          })}
                </Text>
            ),
        },
        {
            key: 'status',
            label: t('kitchen:ops.dishMargins.columnStatus'),
            width: 240,
            priority: 92,
            render: (row) =>
                row.withheldReason !== null ? (
                    <Badge
                        tone="warning"
                        label={t(`kitchen:ops.dishMargins.withheld.${row.withheldReason}`)}
                    />
                ) : row.isBelowTarget ? (
                    <Badge
                        tone="warning"
                        icon="warning"
                        label={t('kitchen:ops.dishMargins.belowTarget')}
                    />
                ) : report.data?.targetPercent === null ? (
                    <Text tone="secondary">{EM_DASH}</Text>
                ) : (
                    <Badge tone="success" label={t('kitchen:ops.dishMargins.onTarget')} />
                ),
        },
    ];

    const data = report.data;

    return (
        <Cascade space="md" testID="kitchen-dish-margins-screen">
            {report.isPending ? (
                <TableSkeleton testID="kitchen-dish-margins-loading" rows={6} />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-dish-margins-error"
                    title={t('kitchen:ops.dishMargins.loadErrorTitle')}
                    failure={failure}
                    onRetry={() => {
                        void report.refetch();
                    }}
                    retrying={report.isFetching}
                />
            ) : data === undefined ? null : data.dishes.length === 0 ? (
                <EmptyState
                    testID="kitchen-dish-margins-empty"
                    title={t('kitchen:ops.dishMargins.empty')}
                />
            ) : (
                <View className="flex-col gap-loose">
                    {/*
                     * The Lens bar, like every list: the dishes and the ones below target as figures
                     * you can press, the target itself as a figure — and, with none set, an amber
                     * "Not set" that opens branch operating, where it is set. The time the margins
                     * were worked out sits at the end of the row.
                     */}
                    <LensBar
                        testID="kitchen-dish-margins-lens"
                        label={t('kitchen:ops.dishMargins.lensLabel')}
                        figures={dishFigures(data, belowOnly, setBelowOnly, router, t)}
                        result={
                            data.computedAt === null
                                ? null
                                : t('kitchen:ops.dishMargins.asOf', {
                                      when: formatter.formatDate(data.computedAt, {
                                          dateStyle: 'medium',
                                          timeStyle: 'short',
                                      }),
                                  })
                        }
                        clearLabel={t('kitchen:lens.clear')}
                    />
                    <DataTable<DishMargin>
                        testID="kitchen-dish-margins-table"
                        label={t('kitchen:ops.dishMargins.heading')}
                        columns={columns}
                        rows={
                            belowOnly ? data.dishes.filter((row) => row.isBelowTarget) : data.dishes
                        }
                        rowKey={(row) => row.id}
                        onRowPress={
                            canOpenRecipe
                                ? (row) => {
                                      open(row, 'production');
                                  }
                                : undefined
                        }
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={canOpenRecipe ? rowActions : undefined}
                    />
                </View>
            )}
        </Cascade>
    );
}

/** All dishes · Below target │ Target margin — the Lens bar's figures for the margins report. */
function dishFigures(
    data: { readonly dishes: readonly DishMargin[]; readonly targetPercent: number | null },
    belowOnly: boolean,
    setBelowOnly: (next: boolean) => void,
    router: ReturnType<typeof useRouter>,
    t: TFunction,
): readonly LensFigure[] {
    const below = data.dishes.filter((row) => row.isBelowTarget).length;
    return [
        {
            key: 'all',
            label: t('kitchen:ops.dishMargins.figureAll'),
            value: data.dishes.length,
            active: !belowOnly,
            onPress: () => {
                setBelowOnly(false);
            },
            accessibilityLabel: t('kitchen:ops.dishMargins.showAll'),
        },
        {
            key: 'below',
            label: t('kitchen:ops.dishMargins.belowTarget'),
            value: below,
            tone: 'warning',
            active: belowOnly,
            onPress: () => {
                setBelowOnly(true);
            },
            accessibilityLabel: t('kitchen:ops.dishMargins.showBelow'),
        },
        data.targetPercent === null
            ? {
                  key: 'target',
                  label: t('kitchen:ops.dishMargins.figureTarget'),
                  value: 0,
                  display: t('kitchen:ops.dishMargins.targetNotSet'),
                  tone: 'warning',
                  separated: true,
                  info: t('kitchen:ops.dishMargins.noTarget'),
                  onPress: () => {
                      router.push('/kitchen/branch-operating' as never);
                  },
                  accessibilityLabel: t('kitchen:ops.dishMargins.setTarget'),
              }
            : {
                  key: 'target',
                  label: t('kitchen:ops.dishMargins.figureTarget'),
                  value: data.targetPercent,
                  display: `${String(data.targetPercent)}%`,
                  tone: 'success',
                  separated: true,
              },
    ];
}

import type { DishMargin } from '@healthy360/api-client/contracts';
import {
    Badge,
    Cascade,
    EmptyState,
    ErrorState,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useDishMarginsQuery } from '../../../data/kitchen-ops-hooks.ts';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { RECIPE_VIEW_COSTS_PERMISSION, RECIPE_VIEW_PERMISSION } from '../entity-registry.ts';

import { DeskChip } from '../desk-kit/desk-chip.tsx';
/**
 * `/kitchen/dish-margins` — what each dish earns at today's costs, lowest first.
 *
 * One list in the cash report's table. A withheld margin is a badge with its reason and never a
 * number: a margin over part of a recipe reads like a whole one and is too high. Below target is a
 * warning badge with its wording, so colour is not the only signal.
 *
 * A row opens its dish's recipe on Production, and its actions open it on Production or on Selling
 * (where the list price is set), each coming back here. Only for a reader who may open recipes.
 */

const EM_DASH = '—';
const RETURN_HREF = '/kitchen/dish-margins';

/** The dish's recipe, under its item's address, on one editor tab. */
function recipeHref(row: DishMargin, tab: 'production' | 'selling'): string {
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
    const canOpenRecipe = useCan(RECIPE_VIEW_PERMISSION);
    const open = (row: DishMargin, tab: 'production' | 'selling') => {
        router.push(recipeHref(row, tab) as never);
    };
    const rowActions = (row: DishMargin): readonly MenuItem[] => [
        {
            key: 'recipe',
            label: t('kitchen:ops.dishMargins.openRecipe'),
            icon: CATALOGUE_ROW_ICONS.view,
            onSelect: () => {
                open(row, 'production');
            },
        },
        {
            key: 'price',
            label: t('kitchen:ops.dishMargins.changePrice'),
            icon: 'tag',
            onSelect: () => {
                open(row, 'selling');
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

    const columns: readonly CatalogueColumn<DishMargin>[] = [
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
            key: 'channel',
            label: t('kitchen:ops.dishMargins.columnChannel'),
            width: 110,
            priority: 70,
            render: (row) => (
                <Text tone="secondary">{t(`kitchen:ops.dishMargins.channel.${row.channel}`)}</Text>
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
                <Text variant="mono" tone="secondary">
                    {money(row.costAmount, row.currencyCode)}
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
                    <DeskChip
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
                    <DeskChip tone="success" label={t('kitchen:ops.dishMargins.onTarget')} />
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
                    <Text variant="section" accessibilityRole="header">
                        {t('kitchen:ops.dishMargins.heading')}
                    </Text>
                    <Text variant="caption" tone="secondary" testID="kitchen-dish-margins-note">
                        {[
                            data.targetPercent === null
                                ? t('kitchen:ops.dishMargins.noTarget')
                                : t('kitchen:ops.dishMargins.targetNote', {
                                      percent: data.targetPercent,
                                  }),
                            data.computedAt === null
                                ? null
                                : t('kitchen:ops.dishMargins.asOf', {
                                      when: formatter.formatDate(data.computedAt, {
                                          dateStyle: 'medium',
                                          timeStyle: 'short',
                                      }),
                                  }),
                        ]
                            .filter((part) => part !== null)
                            .join(' ')}
                    </Text>
                    <CatalogueList<DishMargin>
                        testID="kitchen-dish-margins-table"
                        label={t('kitchen:ops.dishMargins.heading')}
                        columns={columns}
                        rows={data.dishes}
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

import {
    Breadcrumbs,
    Button,
    Callout,
    EmptyState,
    Heading,
    Stack,
    Table,
    Text,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import type { PlanVariant, SubscriptionPlan } from '@healthy360/api-client/contracts';
import { SubscriptionPlanId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { usePlanComparisonQuery } from '../../../data/catalogue-hooks.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';

/**
 * `/plans/compare` — two or three plans, side by side.
 *
 * Neither reference product has a comparison surface (doc 17, IA-10), so the whole screen is
 * original. Three decisions carry it.
 *
 * **The table is transposed.** One row per *metric*, one column per plan — not one row per plan.
 * Comparison is a vertical scan of the same figure across candidates, and a row-per-plan layout
 * makes the reader compare across a row instead, which is the harder direction and the one that
 * loses alignment as soon as the columns differ in width.
 *
 * **Columns carry equal emphasis.** No "recommended" badge, no highlighted column, no reordering by
 * price. A comparison that nudges is not a comparison; it is an advert with a table around it.
 *
 * **It stacks rather than scrolls.** `Table` becomes one card per metric below `md`, which keeps the
 * horizontal scrolling inside the component and off the document (doc 08, RSP-01).
 */

/** Days in a week — the divisor behind the "price a day" row. */
const DAYS_PER_WEEK = 7;

interface ComparisonRow {
    readonly key: string;
    readonly header: string;
    readonly render: (plan: SubscriptionPlan) => string;
}

function cheapestVariant(plan: SubscriptionPlan): PlanVariant | null {
    return plan.variants.reduce<PlanVariant | null>(
        (lowest, variant) =>
            lowest === null || variant.pricePerWeek.amount < lowest.pricePerWeek.amount
                ? variant
                : lowest,
        null,
    );
}

function rangeText(
    formatter: Formatter,
    t: TFunction,
    ranges: readonly ({ readonly min: number; readonly max: number } | null)[],
): string {
    const known = ranges.filter(
        (range): range is { readonly min: number; readonly max: number } => range !== null,
    );
    if (known.length === 0) return '—';
    const min = Math.min(...known.map((range) => range.min));
    const max = Math.max(...known.map((range) => range.max));
    return t('catalogue:plan.macroRange', {
        min: formatter.formatNumber(min),
        max: formatter.formatNumber(max),
    });
}

export function PlanComparisonScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const params = useLocalSearchParams<{ plans?: string }>();

    const planIds = useMemo<readonly SubscriptionPlanId[]>(() => {
        const parameter: string | string[] | undefined = params.plans;
        const raw: string = (Array.isArray(parameter) ? parameter[0] : parameter) ?? '';
        return raw
            .split(',')
            .map((value: string) => SubscriptionPlanId.safeParse(value.trim()))
            .filter((value): value is SubscriptionPlanId => value !== null);
    }, [params.plans]);

    const comparison = usePlanComparisonQuery(planIds);
    const plans = comparison.data ?? [];

    const rows: readonly ComparisonRow[] = [
        {
            key: 'energy',
            header: t('catalogue:compare.row.energy'),
            render: (plan) =>
                plan.variants
                    .map((variant) =>
                        t('catalogue:plans.energyBand', {
                            min: formatter.formatNumber(variant.energyRange.min),
                            max: formatter.formatNumber(variant.energyRange.max),
                        }),
                    )
                    .join(t('catalogue:common.listSeparator')),
        },
        {
            key: 'protein',
            header: t('catalogue:compare.row.protein'),
            render: (plan) =>
                rangeText(
                    formatter,
                    t,
                    plan.variants.map((variant) => variant.proteinRange),
                ),
        },
        {
            key: 'carbohydrate',
            header: t('catalogue:compare.row.carbohydrate'),
            render: (plan) =>
                rangeText(
                    formatter,
                    t,
                    plan.variants.map((variant) => variant.carbohydrateRange),
                ),
        },
        {
            key: 'fat',
            header: t('catalogue:compare.row.fat'),
            render: (plan) =>
                rangeText(
                    formatter,
                    t,
                    plan.variants.map((variant) => variant.fatRange),
                ),
        },
        {
            key: 'meals',
            header: t('catalogue:compare.row.meals'),
            render: (plan) => {
                const meals = Math.max(...plan.variants.map((variant) => variant.mealsPerDay));
                const snacks = Math.max(...plan.variants.map((variant) => variant.snacksPerDay));
                return snacks === 0
                    ? t('catalogue:plans.mealsPerDayNoSnacks', {
                          meals: formatter.formatNumber(meals),
                      })
                    : t('catalogue:plans.mealsPerDay', {
                          meals: formatter.formatNumber(meals),
                          snacks: formatter.formatNumber(snacks),
                      });
            },
        },
        {
            key: 'durations',
            header: t('catalogue:compare.row.durations'),
            render: (plan) =>
                plan.durations
                    .map((option) =>
                        option.discountPercent > 0
                            ? t('catalogue:compare.durationOption', {
                                  duration: t(`catalogue:compare.duration.${option.duration}`),
                                  discount: formatter.formatNumber(option.discountPercent),
                              })
                            : t('catalogue:compare.durationOptionNoDiscount', {
                                  duration: t(`catalogue:compare.duration.${option.duration}`),
                              }),
                    )
                    .join(t('catalogue:common.listSeparator')),
        },
        {
            key: 'delivery',
            header: t('catalogue:compare.row.delivery'),
            // The consumer contract publishes no delivery-day constraint on a plan; the honest
            // answer is the sentence that says so, not a guessed list of weekdays.
            render: () => t('catalogue:plan.deliveryUnpublishedShort'),
        },
        {
            key: 'pricePerDay',
            header: t('catalogue:compare.row.pricePerDay'),
            render: (plan) => {
                const variant = cheapestVariant(plan);
                if (variant === null) return '—';
                return formatMoney(formatter, {
                    amount: Math.round(variant.pricePerWeek.amount / DAYS_PER_WEEK),
                    currency: variant.pricePerWeek.currency,
                });
            },
        },
    ];

    const columns: readonly TableColumn<ComparisonRow>[] = [
        {
            key: 'metric',
            header: t('catalogue:compare.caption'),
            rowHeader: true,
            flex: 1.2,
            render: (row) => <Text variant="bodyStrong">{row.header}</Text>,
        },
        ...plans.map<TableColumn<ComparisonRow>>((plan) => ({
            key: String(plan.id),
            header: plan.name,
            render: (row) => (
                <Text testID={`plan-compare-${row.key}-${plan.slug}`}>{row.render(plan)}</Text>
            ),
        })),
    ];

    return (
        <Stack space="lg" testID="plan-comparison-screen">
            <Breadcrumbs
                testID="plan-comparison-breadcrumbs"
                items={[
                    {
                        key: 'home',
                        label: t('catalogue:nav.home'),
                        onPress: () => {
                            router.push('/');
                        },
                    },
                    {
                        key: 'plans',
                        label: t('catalogue:nav.plans'),
                        onPress: () => {
                            router.push('/plans');
                        },
                    },
                    { key: 'compare', label: t('catalogue:nav.compare') },
                ]}
            />

            <Stack space="xs">
                <Heading level={1} testID="plan-comparison-title">
                    {t('catalogue:compare.title')}
                </Heading>
                <Text tone="secondary">{t('catalogue:compare.subtitle')}</Text>
            </Stack>

            {/* An empty selection leaves the query disabled, so it never settles and `QueryStates`
                would show a skeleton for ever. "Nothing was selected" is not a pending request —
                it is the answer, and it is rendered as one. */}
            {planIds.length === 0 ? (
                <EmptyState
                    testID="plan-comparison-empty"
                    title={t('catalogue:compare.emptyTitle')}
                    body={t('catalogue:compare.emptyBody')}
                    actions={
                        <Button
                            testID="plan-comparison-back"
                            variant="quiet"
                            label={t('catalogue:compare.backToPlans')}
                            onPress={() => {
                                router.push('/plans');
                            }}
                        />
                    }
                />
            ) : (
                <QueryStates
                    query={comparison}
                    isEmpty={plans.length === 0}
                    emptyTitle={t('catalogue:compare.emptyTitle')}
                    emptyBody={t('catalogue:compare.emptyBody')}
                    emptyActions={
                        <Button
                            testID="plan-comparison-back"
                            variant="quiet"
                            label={t('catalogue:compare.backToPlans')}
                            onPress={() => {
                                router.push('/plans');
                            }}
                        />
                    }
                    skeletonCount={2}
                    testID="plan-comparison"
                >
                    <Stack space="md">
                        <Table
                            testID="plan-comparison-table"
                            caption={t('catalogue:compare.caption')}
                            captionHidden
                            columns={columns}
                            rows={rows}
                            rowKey={(row) => row.key}
                        />

                        <Stack space="sm" testID="plan-comparison-links">
                            {plans.map((plan) => (
                                <Button
                                    key={plan.id}
                                    testID={`plan-comparison-open-${plan.slug}`}
                                    variant="secondary"
                                    label={t('catalogue:compare.openPlan', { plan: plan.name })}
                                    onPress={() => {
                                        router.push(`/plans/${String(plan.id)}` as never);
                                    }}
                                />
                            ))}
                        </Stack>

                        <Callout
                            testID="plan-comparison-caveat"
                            role="note"
                            tone="info"
                            icon="info"
                            title={t('catalogue:plan.macrosTitle')}
                            body={t('catalogue:compare.macroCaveat')}
                        />
                    </Stack>
                </QueryStates>
            )}
        </Stack>
    );
}

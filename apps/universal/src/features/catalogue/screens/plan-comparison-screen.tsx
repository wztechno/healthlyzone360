import { Button, EmptyState } from '@healthy360/design-system';
import type { SubscriptionPlan } from '@healthy360/api-client/contracts';
import { SubscriptionPlanId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { usePlanComparisonQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { withQuery } from '../../../navigation/return-to.ts';
import { useNavigateUp } from '../../../navigation/use-return-to.ts';
import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { ListingHeader } from '../../../ui/listing-header.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { listDayPrice } from '../plan-balance.ts';
import { cheapestVariant } from '../plan-catalogue.ts';
import { durationLabel } from '../plan-duration-label.ts';

/**
 * `/plans/compare` — two or three plans, side by side.
 *
 * **One column per plan, the label above the values.** Comparison is a vertical scan of the same
 * figure across candidates, so every row lays its values out in the same equal columns. The label
 * sits over the row rather than in a column of its own, which is what lets three plans fit a phone
 * without a horizontal scroll.
 *
 * **The head is the plan.** Name, kitchen, price a day and Choose sit at the top of each column and
 * stay pinned on the web while the figures scroll under them — the reader always knows which
 * column is which, and the decision is one press from the figure that settled it.
 *
 * **Columns carry equal emphasis.** No "recommended" badge, no highlighted column, no reordering by
 * price. A comparison that nudges is an advert with a table around it.
 *
 * **Every text is `self-start`.** A Latin plan name or a bare figure inside an Arabic page is an
 * LTR run, and the web's `text-align: start` resolves against the run rather than the page; shrunk
 * to its content and placed by the column instead, it sits on the column's start edge either way.
 *
 * **A row nobody publishes is not drawn.** Macro ranges are optional on a plan; a row of dashes in
 * every column tells the reader nothing, so it is left out. A row where *some* plan publishes the
 * figure keeps a dash for the others — there the absence is the difference.
 *
 * **"Back to the plans" means back.** `/plans` keeps its compare tray in `?compare=` and its kitchen
 * chip in `?kitchen=`; the comparison is opened with both (`?plans=&kitchen=`) and returns both, by
 * Back when `/plans` is the entry underneath and by opening it with them otherwise. It used to push a
 * bare `/plans`, which emptied the tray the person had just filled (browse-05).
 */

interface ComparisonRow {
    readonly key: string;
    readonly label: string;
    readonly value: (plan: SubscriptionPlan) => string | null;
}

/** A closed range as "3" or "2–3"; `null` for an empty set. */
function countRange(formatter: Formatter, t: TFunction, values: readonly number[]): string | null {
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    return min === max
        ? formatter.formatNumber(min)
        : t('catalogue:compare.countRange', {
              min: formatter.formatNumber(min),
              max: formatter.formatNumber(max),
          });
}

/** The widest range across the plan's bands, or `null` when no band publishes one. */
function macroRange(
    formatter: Formatter,
    t: TFunction,
    ranges: readonly ({ readonly min: number; readonly max: number } | null)[],
): string | null {
    const known = ranges.filter(
        (range): range is { readonly min: number; readonly max: number } => range !== null,
    );
    if (known.length === 0) return null;
    return t('catalogue:plan.macroRange', {
        min: formatter.formatNumber(Math.min(...known.map((range) => range.min))),
        max: formatter.formatNumber(Math.max(...known.map((range) => range.max))),
    });
}

export function PlanComparisonScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const navigateUp = useNavigateUp();
    const formatter = useFormatter();
    const params = useLocalSearchParams<{ plans?: string; kitchen?: string }>();

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
    // The same query `/plans` names kitchens with, so it is usually already cached.
    const kitchens = useKitchensQuery({ channels: ['marketplace'], limit: 20 });
    const kitchenNameById = useMemo(() => {
        const map = new Map<string, string>();
        for (const kitchen of kitchens.data?.items ?? []) map.set(String(kitchen.id), kitchen.name);
        return map;
    }, [kitchens.data]);

    const allRows: readonly ComparisonRow[] = [
        {
            key: 'energy',
            label: t('catalogue:compare.row.energy'),
            value: (plan) =>
                plan.variants.length === 0
                    ? null
                    : plan.variants
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
            label: t('catalogue:compare.row.protein'),
            value: (plan) =>
                macroRange(
                    formatter,
                    t,
                    plan.variants.map((variant) => variant.proteinRange),
                ),
        },
        {
            key: 'carbohydrate',
            label: t('catalogue:compare.row.carbohydrate'),
            value: (plan) =>
                macroRange(
                    formatter,
                    t,
                    plan.variants.map((variant) => variant.carbohydrateRange),
                ),
        },
        {
            key: 'fat',
            label: t('catalogue:compare.row.fat'),
            value: (plan) =>
                macroRange(
                    formatter,
                    t,
                    plan.variants.map((variant) => variant.fatRange),
                ),
        },
        {
            key: 'meals',
            label: t('catalogue:compare.row.meals'),
            value: (plan) =>
                countRange(
                    formatter,
                    t,
                    plan.variants.map((variant) => variant.mealsPerDay),
                ),
        },
        {
            key: 'snacks',
            label: t('catalogue:compare.row.snacks'),
            value: (plan) =>
                countRange(
                    formatter,
                    t,
                    plan.variants.map((variant) => variant.snacksPerDay),
                ),
        },
        {
            key: 'durations',
            label: t('catalogue:compare.row.durations'),
            value: (plan) =>
                plan.durations.length === 0
                    ? null
                    : plan.durations
                          .map((option) =>
                              option.discountPercent > 0
                                  ? t('catalogue:compare.durationOption', {
                                        duration: durationLabel(
                                            option.days,
                                            t,
                                            formatter.formatNumber,
                                        ),
                                        discount: formatter.formatNumber(option.discountPercent),
                                    })
                                  : durationLabel(option.days, t, formatter.formatNumber),
                          )
                          .join(t('catalogue:common.listSeparator')),
        },
    ];
    const rows = allRows.filter((row) => plans.some((plan) => row.value(plan) !== null));

    // `/plans` as the person left it: the selection that opened this page, and their kitchen chip.
    const kitchenParameter: string | string[] | undefined = params.kitchen;
    const plansHref = withQuery('/plans', {
        kitchen: Array.isArray(kitchenParameter) ? kitchenParameter[0] : kitchenParameter,
        compare: planIds.map(String).join(','),
    });
    const backToPlans = () => {
        navigateUp(plansHref);
    };

    const back = (
        <Button
            testID="plan-comparison-back"
            variant="quiet"
            label={t('catalogue:compare.backToPlans')}
            onPress={backToPlans}
        />
    );

    return (
        <View testID="plan-comparison-screen" className="flex-col">
            <ListingHeader
                testID="plan-comparison-header"
                breadcrumbs={[
                    {
                        key: 'plans',
                        label: t('catalogue:nav.plans'),
                        testID: 'plan-comparison-crumb-plans',
                        onPress: backToPlans,
                    },
                    { key: 'compare', label: t('catalogue:nav.compare') },
                ]}
                title={t('catalogue:compare.title')}
            />

            <View className="mt-6">
                {/* An empty selection leaves the query disabled, so it never settles and
                    `QueryStates` would show a skeleton for ever. "Nothing was selected" is not a
                    pending request — it is the answer, and it is rendered as one. */}
                {planIds.length === 0 ? (
                    <EmptyState
                        testID="plan-comparison-empty"
                        title={t('catalogue:compare.emptyTitle')}
                        body={t('catalogue:compare.emptyBody')}
                        actions={back}
                    />
                ) : (
                    <QueryStates
                        query={comparison}
                        isEmpty={plans.length === 0}
                        emptyTitle={t('catalogue:compare.emptyTitle')}
                        emptyBody={t('catalogue:compare.emptyBody')}
                        emptyActions={back}
                        skeletonCount={2}
                        testID="plan-comparison"
                    >
                        <View
                            testID="plan-comparison-table"
                            role="table"
                            aria-label={t('catalogue:compare.caption')}
                            className="flex-col"
                        >
                            {/*
                             * Sticky on the web against the shell's scroll port — `top-0` pins it
                             * just under the marketplace bar.
                             */}
                            <View
                                testID="plan-comparison-head"
                                role="row"
                                className="z-10 flex-row gap-4 border-b border-stroke bg-surface-base pb-4 pt-2 web:sticky web:top-0"
                            >
                                {plans.map((plan) => (
                                    <PlanHead
                                        key={plan.id}
                                        plan={plan}
                                        kitchenName={kitchenNameById.get(String(plan.kitchenId))}
                                        onChoose={() => {
                                            router.push(`/plans/${String(plan.id)}` as never);
                                        }}
                                    />
                                ))}
                            </View>

                            {rows.map((row) => (
                                <View
                                    key={row.key}
                                    testID={`plan-comparison-row-${row.key}`}
                                    role="row"
                                    className="flex-col gap-2 border-b border-stroke-subtle py-4"
                                >
                                    <View role="rowheader">
                                        <Eyebrow>{row.label}</Eyebrow>
                                    </View>
                                    <View className="flex-row gap-4">
                                        {plans.map((plan) => (
                                            <View
                                                key={plan.id}
                                                role="cell"
                                                className="min-w-0 flex-1"
                                            >
                                                <RNText
                                                    testID={`plan-compare-${row.key}-${plan.slug}`}
                                                    className="self-start text-base tabular-nums text-content-primary text-start"
                                                >
                                                    {row.value(plan) ??
                                                        t('catalogue:compare.noFigure')}
                                                </RNText>
                                            </View>
                                        ))}
                                    </View>
                                </View>
                            ))}
                        </View>
                    </QueryStates>
                )}
            </View>
        </View>
    );
}

/** One column's head: the plan, its kitchen, its price a day, and the way to choose it. */
function PlanHead({
    plan,
    kitchenName,
    onChoose,
}: {
    readonly plan: SubscriptionPlan;
    readonly kitchenName: string | undefined;
    readonly onChoose: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const cheapest = cheapestVariant(plan);

    return (
        <View
            testID={`plan-comparison-head-${plan.slug}`}
            role="columnheader"
            className="min-w-0 flex-1 flex-col gap-1"
        >
            <RNText
                numberOfLines={2}
                className="self-start font-display text-lg font-bold tracking-display text-content-primary text-start"
            >
                {plan.name}
            </RNText>
            {kitchenName === undefined ? null : (
                <RNText
                    numberOfLines={1}
                    className="self-start text-sm text-content-secondary text-start"
                >
                    {kitchenName}
                </RNText>
            )}
            {cheapest === null ? null : (
                <View className="mt-1 flex-row flex-wrap items-baseline gap-1">
                    <RNText
                        testID={`plan-compare-price-${plan.slug}`}
                        className="font-display text-2xl font-bold tabular-nums tracking-display text-content-primary text-start"
                    >
                        {formatMoney(formatter, listDayPrice(cheapest))}
                    </RNText>
                    <RNText className="text-sm text-content-secondary">
                        {t('catalogue:plans.perDaySuffix')}
                    </RNText>
                </View>
            )}
            <View className="mt-2">
                <Button
                    testID={`plan-comparison-open-${plan.slug}`}
                    variant="primary"
                    label={t('catalogue:plans.choosePlanShort')}
                    accessibilityLabel={t('catalogue:plans.choosePlan', { plan: plan.name })}
                    onPress={onChoose}
                />
            </View>
        </View>
    );
}
